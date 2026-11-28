import { DBOS } from '@dbos-inc/dbos-sdk';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { estimateTokens } from '../../../ai/index.ts';
import { config } from '../../../config.ts';
import type { Money } from '../../../contracts/common.ts';
import { isUniqueViolation } from '../../../db/client.ts';
import { discoveryRuns, type DiscoveryCounts } from '../../../db/schema/research.ts';
import { isUuid, withBrand, type Tx } from '../../../db/tenant.ts';
import { BudgetError, ConflictError, NotFoundError } from '../../../http/errors.ts';
import { searchPrice, searchReady } from '../../../search/index.ts';
import { cancelRun, QUEUE, retryRun, type RunTable } from '../../../workflows/index.ts';
import { discoveryWorkflow } from '../../../workflows/research-discovery.ts';
import { audit } from '../../audit/index.ts';
import { estimateCost, remainingMonthlyCap } from '../../costs/index.ts';
import { approvedFacts } from '../../knowledge/index.ts';
import { addMoney } from '../watch/money.ts';
import { cleanKeywords } from './keywords.ts';
import { MAX_CANDIDATES } from './match.ts';
import {
  factsBlock, GROUP_MAX_OUTPUT, GROUP_SYSTEM, MAX_PAGE_CHARS, OWN_MAX_OUTPUT, OWN_SYSTEM, PROFILE_MAX_OUTPUT, PROFILE_SYSTEM, RESULT_CHARS,
  RESULTS_PER_BUSINESS,
} from './prompts.ts';

export type DiscoveryRun = typeof discoveryRuns.$inferSelect;

const ACTIVE_MESSAGE = 'A discovery run is already in progress for this brand';
const RESULTS_PER_KEYWORD = 30; // 10 web results and up to 20 Maps listings

/**
 * The most a run can cost (spec §5.2): two queries per keyword, the group call over every result, MAX_CANDIDATES profile
 * calls and the own-row call, each at its longest input and its output cap.
 */
export async function estimateDiscovery(tx: Tx, brandId: string, keywords: string[]): Promise<Money> {
  const facts = factsBlock(await approvedFacts(tx, brandId));
  const call = (cap: number, ...texts: string[]) =>
    estimateCost(config.AI_MODEL, estimateTokens(texts.map((text) => ({ type: 'text' as const, text }))), cap);
  const profile = call(PROFILE_MAX_OUTPUT, PROFILE_SYSTEM, facts, 'x'.repeat(MAX_PAGE_CHARS + RESULTS_PER_BUSINESS * RESULT_CHARS));
  return addMoney([
    ...keywords.flatMap(() => [searchPrice('web'), searchPrice('places')]),
    call(GROUP_MAX_OUTPUT, GROUP_SYSTEM, 'x'.repeat(keywords.length * RESULTS_PER_KEYWORD * RESULT_CHARS)),
    ...Array<Money>(MAX_CANDIDATES).fill(profile),
    call(OWN_MAX_OUTPUT, OWN_SYSTEM, facts),
  ]);
}

/** Creates the run awaiting approval with its estimate and queues its workflow (the workflow ID is the run ID). Nothing is searched yet. */
export async function createDiscovery(brandId: string, raw: string[]): Promise<{ runId: string }> {
  const runId = await withBrand(brandId, async (tx) => {
    searchReady();
    const keywords = cleanKeywords(raw);
    const estimate = await estimateDiscovery(tx, brandId, keywords);
    const id = (await tx.execute<{ id: string }>(sql`select uuidv7() as id`)).rows[0]!.id;
    try {
      await tx.insert(discoveryRuns).values({ id, brandId, keywords, state: 'awaiting_approval', estimate, workflowId: id });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictError(ACTIVE_MESSAGE);
      throw e;
    }
    await audit(tx, { brandId, actor: 'operator', action: 'research.discovery.start', objectType: 'discovery_run', objectId: id, result: 'ok' });
    return id;
  });
  await DBOS.startWorkflow(discoveryWorkflow, { queueName: QUEUE, workflowID: runId })(brandId, runId);
  return { runId };
}

export async function getDiscovery(tx: Tx, brandId: string, runId: string): Promise<DiscoveryRun> {
  const [row] = isUuid(runId)
    ? await tx.select().from(discoveryRuns).where(and(eq(discoveryRuns.id, runId), eq(discoveryRuns.brandId, brandId)))
    : [];
  if (!row) throw new NotFoundError('discovery_run', runId);
  return row;
}

export async function listDiscoveries(tx: Tx, brandId: string): Promise<DiscoveryRun[]> {
  return tx.select().from(discoveryRuns).where(eq(discoveryRuns.brandId, brandId)).orderBy(desc(discoveryRuns.createdAt)).limit(50);
}

/** The owner accepts the estimate of a run waiting at awaiting_approval; BudgetError when it is above what this month's cap has left. */
export async function confirmDiscovery(brandId: string, runId: string): Promise<void> {
  const run = await withBrand(brandId, async (tx) => {
    const r = await getDiscovery(tx, brandId, runId);
    if (r.state !== 'awaiting_approval') throw new ConflictError('This run is not waiting for approval');
    const remaining = await remainingMonthlyCap(tx);
    const npr = r.estimate?.npr ?? '0';
    if (Number(npr) > Number(remaining.npr))
      throw new BudgetError(`This run may cost up to NPR ${npr}; NPR ${remaining.npr} of this month's AI budget is left`);
    // Only from awaiting_approval, so a confirm racing another, a cancel or the expiry cannot revive the run as running.
    const [moved] = await tx
      .update(discoveryRuns).set({ state: 'running', startedAt: new Date() })
      .where(and(eq(discoveryRuns.id, runId), eq(discoveryRuns.state, 'awaiting_approval')))
      .returning({ id: discoveryRuns.id });
    if (!moved) throw new ConflictError('This run is not waiting for approval');
    await audit(tx, { brandId, actor: 'operator', action: 'research.discovery.confirm', objectType: 'discovery_run', objectId: runId, result: 'ok' });
    return r;
  });
  await DBOS.send(run.workflowId ?? runId, 'confirmed', 'approval');
}

/** Ends a run that is still running or waiting, with what it spent (its cost_events) and an audit event. */
export async function setDiscoveryState(
  brandId: string, runId: string, to: 'completed' | 'failed_retryable' | 'failed_final' | 'cancelled',
  patch: { error?: string; counts?: Partial<DiscoveryCounts> } = {},
): Promise<void> {
  await withBrand(brandId, async (tx) => {
    const [spent] = (
      await tx.execute<Money>(
        sql`select coalesce(sum(cost_usd), 0)::numeric(14,4)::text as usd, coalesce(sum(cost_npr), 0)::numeric(14,2)::text as npr
            from cost_events where run_id = ${runId}`,
      )
    ).rows;
    const [row] = await tx
      .update(discoveryRuns)
      .set({
        state: to, ...(patch.error ? { error: patch.error } : {}), ...(patch.counts ? { counts: patch.counts } : {}),
        finishedAt: new Date(), actual: spent!,
      })
      .where(and(eq(discoveryRuns.id, runId), inArray(discoveryRuns.state, ['running', 'awaiting_approval'])))
      .returning({ id: discoveryRuns.id });
    if (row)
      await audit(tx, {
        brandId, actor: 'system', action: `research.discovery.${to}`, objectType: 'discovery_run', objectId: runId,
        result: to === 'completed' || to === 'cancelled' ? 'ok' : 'failed', reason: patch.error,
      });
  });
}

const RUNS: RunTable = { table: discoveryRuns, get: getDiscovery, action: 'research.discovery', objectType: 'discovery_run' };
export const cancelDiscovery = (brandId: string, runId: string) => cancelRun(RUNS, brandId, runId);
/** Restarts a failed run from its first failed step; earlier steps (and their paid calls) are not repeated. */
export const retryDiscovery = (brandId: string, runId: string) => retryRun(RUNS, brandId, runId, ACTIVE_MESSAGE);
