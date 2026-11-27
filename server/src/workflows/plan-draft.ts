// The plan draft run: one model call that drafts a week of items or a campaign brief. The run ID is
// the DBOS workflow ID.
import { DBOS } from '@dbos-inc/dbos-sdk';
import type { ApprovedFact, Money } from '../contracts/common.ts';
import type { PlanCounts } from '../db/schema/plan.ts';
import { draftBrief, storeBrief } from '../domain/plan/brief.ts';
import { draftWeek, setRunState, storeWeek } from '../domain/plan/steps.ts';
import { isFinal, runError } from './index.ts';

export const planWorkflow = DBOS.registerWorkflow(
  async (brandId: string, runId: string, kind: 'week' | 'brief', targetId: string, facts: ApprovedFact[]): Promise<void> => {
    try {
      // The model call and the store are separate steps: a retry after a failed store reuses the stored answer
      // instead of paying for it again, and a run cancelled during the call never reaches the store.
      let counts: PlanCounts = {};
      let cost: Money;
      if (kind === 'week') {
        const d = await DBOS.runStep(() => draftWeek(brandId, runId, targetId, facts), { name: 'draft' });
        counts = await DBOS.runStep(() => storeWeek(brandId, runId, targetId, facts, d), { name: 'store' });
        cost = d.cost;
      } else {
        const d = await DBOS.runStep(() => draftBrief(brandId, runId, targetId, facts), { name: 'draft' });
        await DBOS.runStep(() => storeBrief(brandId, targetId, d.draft, facts), { name: 'store' });
        cost = d.cost;
      }
      await DBOS.runStep(() => setRunState(brandId, runId, 'completed', { counts, actual: cost }), { name: 'finish' });
    } catch (e) {
      // A cancelled workflow cannot run steps; setRunState only touches runs that are still active.
      await DBOS.runStep(() => setRunState(brandId, runId, isFinal(e) ? 'failed_final' : 'failed_retryable', { error: runError(e) }), { name: 'fail' }).catch(() => {});
      throw e;
    }
  },
  { name: 'planDraft' },
);
