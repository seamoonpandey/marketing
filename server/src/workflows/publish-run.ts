// The send workflow and the every-minute scheduler. Owned by the publish branch.
import { DBOS } from '@dbos-inc/dbos-sdk';
import { dueJobs, reconcileJob, sendJob, sweepStalled, type DueJob, type Stalled } from '../domain/publish/send.ts';
import { QUEUE } from './index.ts';

export const publishWorkflow = DBOS.registerWorkflow(
  async (brandId: string, jobId: string): Promise<void> => {
    await sendJob(brandId, jobId);
  },
  { name: 'publishSend' },
);

/**
 * Starts the send of a due job. The workflow ID is the idempotency key, the attempt number and the due
 * time, so a job dispatched again before it is claimed runs once, and a moved or retried job gets a new run.
 */
export async function startSend(j: DueJob) {
  return DBOS.startWorkflow(publishWorkflow, { queueName: QUEUE, workflowID: `publish:${j.idempotencyKey}:${j.attempts}:${j.dueAt}` })(j.brandId, j.jobId);
}

export const reconcileWorkflow = DBOS.registerWorkflow(
  async (brandId: string, jobId: string): Promise<void> => {
    await reconcileJob(brandId, jobId);
  },
  { name: 'publishReconcile' },
);

/** Starts the reconcile of a job the sweep made unknown: one run per job and attempt. */
export async function startReconcile(s: Stalled) {
  return DBOS.startWorkflow(reconcileWorkflow, { queueName: QUEUE, workflowID: `publish-reconcile:${s.idempotencyKey}:${s.attempts}` })(s.brandId, s.jobId);
}

/** One check: sends that never finished become unknown and are reconciled, then every due job is started. */
export async function publishTick(): Promise<void> {
  // The real time decides, so a late or replayed tick sends nothing early.
  // DBOS refuses to start a workflow from inside a step; started here, each becomes a recorded child run.
  for (const s of await DBOS.runStep(() => sweepStalled(new Date()), { name: 'sweep' })) await startReconcile(s);
  for (const j of await DBOS.runStep(() => dueJobs(new Date()), { name: 'due' })) await startSend(j);
}

const everyMinute = DBOS.registerWorkflow(
  async (scheduledAt: Date): Promise<void> => {
    void scheduledAt;
    await publishTick();
  },
  { name: 'publishEveryMinute' },
);

/** Registers the check that starts every due job each minute. Call once after launch. */
export async function applyPublishSchedule(): Promise<void> {
  await DBOS.applySchedules([{ scheduleName: 'publish-every-minute', workflowFn: everyMinute, schedule: '* * * * *' }]);
}
