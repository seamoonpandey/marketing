import { DBOS } from '@dbos-inc/dbos-sdk';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { ApprovedFact, Money } from '../../contracts/common.ts';
import { planRuns } from '../../db/schema/plan.ts';
import { withBrand, type Tx } from '../../db/tenant.ts';
import { ConflictError, NotFoundError } from '../../http/errors.ts';
import { QUEUE, retryWorkflow } from '../../workflows/index.ts';
import { planWorkflow } from '../../workflows/plan-draft.ts';
import { audit } from '../audit/index.ts';
import { estimateBrief } from './brief.ts';
import { getCampaign } from './campaigns.ts';
import { UUID } from './dates.ts';
import { checkWeekDraft, estimateWeekCost } from './steps.ts';
import { NO_FACTS } from './steps.ts';
import { ValidationError } from '../../http/errors.ts';

export type PlanRun = typeof planRuns.$inferSelect;
const ACTIVE = ['running', 'awaiting_approval'] as const;
const isUnique = (e: unknown) => [e, (e as { cause?: unknown })?.cause].some((x) => (x as { code?: string })?.code === '23505');

export const estimateWeek = estimateWeekCost;

async function start(brandId: string, kind: 'week' | 'brief', targetId: string, facts: ApprovedFact[], estimate: Money): Promise<{ runId: string }> {
  const runId = await withBrand(brandId, async (tx) => {
    const id = (await tx.execute<{ id: string }>(sql`select uuidv7() as id`)).rows[0]!.id;
    try {
      await tx.insert(planRuns).values({ id, brandId, kind, targetId, state: 'running', startedAt: new Date(), workflowId: id, estimate });
    } catch (e) {
      if (isUnique(e)) throw new ConflictError(`A ${kind === 'week' ? 'week draft' : 'brief draft'} is already running for this ${kind === 'week' ? 'week' : 'campaign'}`);
      throw e;
    }
    await audit(tx, { brandId, actor: 'operator', action: 'plan.run.start', objectType: 'plan_run', objectId: id, result: 'ok', reason: kind });
    return id;
  });
  await DBOS.startWorkflow(planWorkflow, { queueName: QUEUE, workflowID: runId })(brandId, runId, kind, targetId, facts);
  return { runId };
}

/** Refused with a ValidationError before any run or model call when there is no approved fact or no channel. */
export async function startWeekDraft(brandId: string, weekStart: string, facts: ApprovedFact[]): Promise<{ runId: string }> {
  await checkWeekDraft(brandId, weekStart, facts);
  return start(brandId, 'week', weekStart, facts, await estimateWeekCost(brandId, weekStart, facts));
}

export async function generateBrief(brandId: string, campaignId: string, facts: ApprovedFact[]): Promise<{ runId: string }> {
  if (!facts.length) throw new ValidationError(NO_FACTS);
  await withBrand(brandId, (tx) => getCampaign(tx, brandId, campaignId));
  return start(brandId, 'brief', campaignId, facts, await estimateBrief(brandId, campaignId, facts));
}

export async function getRun(tx: Tx, brandId: string, runId: string): Promise<PlanRun> {
  const [row] = UUID.test(runId) ? await tx.select().from(planRuns).where(and(eq(planRuns.id, runId), eq(planRuns.brandId, brandId))) : [];
  if (!row) throw new NotFoundError('plan_run', runId);
  return row;
}

/** The newest run of a week (targetId is its start date) or of a campaign's brief. */
export async function latestRun(tx: Tx, brandId: string, kind: 'week' | 'brief', targetId: string): Promise<PlanRun | null> {
  const [row] = await tx.select().from(planRuns)
    .where(and(eq(planRuns.brandId, brandId), eq(planRuns.kind, kind), eq(planRuns.targetId, targetId))).orderBy(desc(planRuns.createdAt)).limit(1);
  return row ?? null;
}

export async function cancelRun(brandId: string, runId: string): Promise<void> {
  const run = await withBrand(brandId, async (tx) => {
    const r = await getRun(tx, brandId, runId);
    if (!(ACTIVE as readonly string[]).includes(r.state)) throw new ConflictError('This run has already finished');
    await tx.update(planRuns).set({ state: 'cancelled', finishedAt: new Date() }).where(eq(planRuns.id, runId));
    await audit(tx, { brandId, actor: 'operator', action: 'plan.run.cancel', objectType: 'plan_run', objectId: runId, result: 'ok' });
    return r;
  });
  await DBOS.cancelWorkflow(run.workflowId ?? runId);
}

/** Restarts a failed run from its failed step; a step that already finished is not repeated. */
export async function retryRun(brandId: string, runId: string): Promise<void> {
  const run = await withBrand(brandId, async (tx) => {
    const r = await getRun(tx, brandId, runId);
    if (r.state !== 'failed_retryable') throw new ConflictError('Only a run that failed with a retryable error can be retried');
    try {
      await tx.update(planRuns).set({ state: 'running', error: null, finishedAt: null }).where(eq(planRuns.id, runId));
    } catch (e) {
      if (isUnique(e)) throw new ConflictError('Another draft is already running for this target');
      throw e;
    }
    await audit(tx, { brandId, actor: 'operator', action: 'plan.run.retry', objectType: 'plan_run', objectId: runId, result: 'ok' });
    return r;
  });
  const handle = await retryWorkflow(run.workflowId ?? runId);
  await withBrand(brandId, (tx) => tx.update(planRuns).set({ workflowId: handle.workflowID }).where(eq(planRuns.id, runId)));
}
