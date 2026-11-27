// The plan draft run: one model call that drafts a week of items or a campaign brief. The run ID is
// the DBOS workflow ID. Owned by the plan branch.
import { DBOS } from '@dbos-inc/dbos-sdk';
import type { ApprovedFact } from '../contracts/common.ts';
import { AiError } from '../ai/index.ts';
import { draftBrief } from '../domain/plan/brief.ts';
import { draftWeek, setRunState } from '../domain/plan/steps.ts';
import { HttpError } from '../http/errors.ts';

export const planWorkflow = DBOS.registerWorkflow(
  async (brandId: string, runId: string, kind: 'week' | 'brief', targetId: string, facts: ApprovedFact[]): Promise<void> => {
    try {
      const r = await DBOS.runStep(
        async () => (kind === 'week' ? draftWeek(brandId, runId, targetId, facts) : { counts: {}, cost: (await draftBrief(brandId, runId, targetId, facts)).cost }),
        { name: 'draft' },
      );
      await DBOS.runStep(() => setRunState(brandId, runId, 'completed', { counts: r.counts, actual: r.cost }), { name: 'finish' });
    } catch (e) {
      // Only an answer the model will not change (a refusal, off-schema output) or a bad request is final;
      // an outage, the monthly cap and anything unknown can be retried.
      const final = (e instanceof AiError && !e.retryable) || e instanceof HttpError && e.status !== 402;
      // A cancelled workflow cannot run steps; setRunState only touches runs that are still active.
      await DBOS.runStep(() => setRunState(brandId, runId, final ? 'failed_final' : 'failed_retryable', { error: (e as Error).message }), { name: 'fail' }).catch(() => {});
      throw e;
    }
  },
  { name: 'planDraft' },
);
