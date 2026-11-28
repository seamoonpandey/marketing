// The watch run (WF-002): snapshot each watched page, diff it, and send only changed pages to the
// model. The run ID is the DBOS workflow ID.
import { DBOS } from '@dbos-inc/dbos-sdk';
import { ConflictError } from '../http/errors.ts';
import { generateOpportunities } from '../domain/research/opportunities.ts';
import { dueBrands, startRun } from '../domain/research/watch/run.ts';
import { capture, estimateRun, extractPage, loadRun, setRunState, type Captured } from '../domain/research/watch/steps.ts';
import { runError } from './index.ts';

const APPROVAL_WAIT_SECONDS = 7 * 86_400;

export const watchWorkflow = DBOS.registerWorkflow(
  async (brandId: string, runId: string): Promise<void> => {
    try {
      const { trigger, targets } = await DBOS.runStep(() => loadRun(brandId, runId), { name: 'load' });
      const captured: Captured[] = [];
      for (const t of targets) captured.push(await DBOS.runStep(() => capture(brandId, t), { name: `capture:${t.id}` }));
      const changed = captured.filter((c) => c.changed && !c.error);

      const { wait } = await DBOS.runStep(() => estimateRun(brandId, runId, trigger, changed), { name: 'estimate' });
      if (wait && !(await DBOS.recv<string>('approval', APPROVAL_WAIT_SECONDS))) {
        await DBOS.runStep(() => setRunState(brandId, runId, 'cancelled', { error: 'Not approved in time' }), { name: 'expire' });
        return;
      }

      let observations = 0;
      let discarded = 0;
      for (const c of changed) {
        const r = await DBOS.runStep(() => extractPage(brandId, runId, c), { name: `extract:${c.targetId}` });
        if ('fatal' in r) {
          await DBOS.runStep(() => setRunState(brandId, runId, 'failed_final', { error: r.fatal }), { name: 'fail' });
          return;
        }
        observations += r.observations;
        discarded += r.discarded;
      }

      const opportunities = observations
        ? await DBOS.runStep(async () => (await generateOpportunities(brandId, runId)).length, { name: 'opportunities' })
        : 0;

      const failed = captured.filter((c) => c.error).length;
      await DBOS.runStep(
        () => setRunState(brandId, runId, 'completed', {
          counts: { pages: targets.length, changed: changed.length, unchanged: captured.length - changed.length - failed, failed, observations, discarded, opportunities },
        }),
        { name: 'finish' },
      );
    } catch (e) {
      // A cancelled workflow cannot run steps; setRunState only touches runs that are still active.
      await DBOS.runStep(() => setRunState(brandId, runId, 'failed_retryable', { error: runError(e) }), { name: 'fail' }).catch(() => {});
      throw e;
    }
  },
  { name: 'researchWatch' },
);

const weeklyCheck = DBOS.registerWorkflow(
  async (scheduledAt: Date): Promise<void> => {
    for (const brandId of await DBOS.runStep(() => dueBrands(scheduledAt), { name: 'due' })) {
      await DBOS.runStep(
        () => startRun(brandId, 'weekly').then(() => undefined, (e) => { if (!(e instanceof ConflictError)) throw e; }),
        { name: `start:${brandId}` },
      );
    }
  },
  { name: 'researchWeeklyCheck' },
);

/** Registers the hourly check that starts a weekly run for each due brand. Call once after launch. */
export async function applyResearchSchedule(): Promise<void> {
  await DBOS.applySchedules([{ scheduleName: 'research-weekly-check', workflowFn: weeklyCheck, schedule: '0 * * * *' }]);
}
