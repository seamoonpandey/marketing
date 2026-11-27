import { DBOS } from '@dbos-inc/dbos-sdk';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { ApprovedFact, Money } from '../../contracts/common.ts';
import { isUniqueViolation } from '../../db/client.ts';
import { planRuns } from '../../db/schema/plan.ts';
import { isUuid, withBrand, type Tx } from '../../db/tenant.ts';
import { ConflictError, NotFoundError } from '../../http/errors.ts';
import { cancelRun as cancelRunIn, QUEUE, retryRun as retryRunIn, type RunTable } from '../../workflows/index.ts';
import { planWorkflow } from '../../workflows/plan-draft.ts';
import { audit } from '../audit/index.ts';
import { estimateBrief } from './brief.ts';
import { getCampaign } from './campaigns.ts';
import { checkWeekDraft, estimateWeekCost } from './steps.ts';
import { NO_FACTS } from './steps.ts';
import { ValidationError } from '../../http/errors.ts';

export type PlanRun = typeof planRuns.$inferSelect;

export const estimateWeek = estimateWeekCost;

async function start(brandId: string, kind: 'week' | 'brief', targetId: string, facts: ApprovedFact[], estimate: Money): Promise<{ runId: string }> {
  const runId = await withBrand(brandId, async (tx) => {
    const id = (await tx.execute<{ id: string }>(sql`select uuidv7() as id`)).rows[0]!.id;
    try {
      await tx.insert(planRuns).values({ id, brandId, kind, targetId, state: 'running', startedAt: new Date(), workflowId: id, estimate });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictError(`A ${kind === 'week' ? 'week draft' : 'brief draft'} is already running for this ${kind === 'week' ? 'week' : 'campaign'}`);
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
  const [row] = isUuid(runId) ? await tx.select().from(planRuns).where(and(eq(planRuns.id, runId), eq(planRuns.brandId, brandId))) : [];
  if (!row) throw new NotFoundError('plan_run', runId);
  return row;
}

/** The newest run of a week (targetId is its start date) or of a campaign's brief. */
export async function latestRun(tx: Tx, brandId: string, kind: 'week' | 'brief', targetId: string): Promise<PlanRun | null> {
  const [row] = await tx.select().from(planRuns)
    .where(and(eq(planRuns.brandId, brandId), eq(planRuns.kind, kind), eq(planRuns.targetId, targetId))).orderBy(desc(planRuns.createdAt)).limit(1);
  return row ?? null;
}

const RUNS: RunTable = { table: planRuns, get: getRun, action: 'plan.run', objectType: 'plan_run' };
export const cancelRun = (brandId: string, runId: string) => cancelRunIn(RUNS, brandId, runId);
/** Restarts a failed run from its failed step; a step that already finished is not repeated. */
export const retryRun = (brandId: string, runId: string) => retryRunIn(RUNS, brandId, runId, 'Another draft is already running for this target');
