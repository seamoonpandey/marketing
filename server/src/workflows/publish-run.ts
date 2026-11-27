// The send workflow and the every-minute scheduler. Owned by the publish branch.
import { DBOS } from '@dbos-inc/dbos-sdk';
import { dueJobs, sendJob, type DueJob } from '../domain/publish/send.ts';
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

const everyMinute = DBOS.registerWorkflow(
  async (scheduledAt: Date): Promise<void> => {
    void scheduledAt; // the real time decides what is due, so a late or replayed tick sends nothing early
    for (const j of await DBOS.runStep(() => dueJobs(new Date()), { name: 'due' })) {
      await DBOS.runStep(async () => void (await startSend(j)), { name: `start:${j.jobId}` });
    }
  },
  { name: 'publishEveryMinute' },
);

/** Registers the check that starts every due job each minute. Call once after launch. */
export async function applyPublishSchedule(): Promise<void> {
  await DBOS.applySchedules([{ scheduleName: 'publish-every-minute', workflowFn: everyMinute, schedule: '* * * * *' }]);
}
