// The brand import: two DBOS workflows joined by a
// stored approval hold. brandImportFetch fetches and prices, then the run waits at awaiting_approval;
// confirmImport enqueues brandImportExtract. Every stage and every batch is its own checkpointed step,
// so a retry resumes at the failed step and a finished model call is never paid for twice.
import { DBOS } from '@dbos-inc/dbos-sdk';
import { withBrand } from '../db/tenant.ts';
import * as run from '../domain/knowledge/import/index.ts';
import { QUEUE, retryWorkflow } from './index.ts';

export { getImport, listImports } from '../domain/knowledge/import/index.ts';

const step = <T>(brandId: string, runId: string, name: string, fn: () => Promise<T>) =>
  DBOS.runStep(() => run.guarded(brandId, runId, fn), { name });

const brandImportFetch = DBOS.registerWorkflow(
  async (brandId: string, runId: string) => {
    await step(brandId, runId, 'fetch', () => run.fetchStage(brandId, runId));
    await step(brandId, runId, 'estimate', () => run.estimateStage(brandId, runId));
  },
  { name: 'brandImportFetch' },
);

const brandImportExtract = DBOS.registerWorkflow(
  async (brandId: string, runId: string) => {
    const batches = await step(brandId, runId, 'plan', () => run.planStage(brandId, runId));
    const answers = [];
    for (const [i, ids] of batches.entries())
      answers.push(await step(brandId, runId, `extract-${i}`, () => run.extractStage(brandId, runId, ids)));
    const counts: Awaited<ReturnType<typeof run.verifyStage>>[] = [];
    for (const [i, facts] of answers.entries())
      counts.push(await step(brandId, runId, `verify-${i}`, () => run.verifyStage(brandId, runId, batches[i]!, facts)));
    const colours = await step(brandId, runId, 'palette', () => run.paletteStage(brandId, runId));
    await step(brandId, runId, 'finish', () => run.finishStage(brandId, runId, counts, colours));
  },
  { name: 'brandImportExtract' },
);

/** Stores the run and enqueues its free fetch-and-estimate workflow. */
export async function startImport(brandId: string, i: { websiteUrl?: string | null; sourceIds: string[] }): Promise<{ runId: string }> {
  const { runId, workflowId } = await withBrand(brandId, (tx) => run.createRun(tx, brandId, i));
  await DBOS.startWorkflow(brandImportFetch, { workflowID: workflowId, queueName: QUEUE })(brandId, runId);
  return { runId };
}

const UNFINISHED = ['PENDING', 'ENQUEUED', 'DELAYED', 'SUSPENDED'];

/**
 * Enqueues the paid extraction. The workflow ID is the run's, so it starts at most once. The enqueue
 * commits before the confirm does, so a crash leaves the run awaiting approval, never running with no
 * workflow; the workflow's first step waits on the run row (running() locks it) for that commit.
 */
export async function confirmImport(brandId: string, runId: string): Promise<void> {
  const workflowId = `brand-import:${runId}:extract`;
  await withBrand(brandId, async (tx) => {
    await run.confirmRun(tx, brandId, runId, workflowId);
    const handle = await DBOS.startWorkflow(brandImportExtract, { workflowID: workflowId, queueName: QUEUE })(brandId, runId);
    // Already finished while the run awaited approval: an earlier confirm enqueued it, then rolled back,
    // so it stopped at its first step without a model call. Replay it.
    const status = (await handle.getStatus())?.status;
    if (status && !UNFINISHED.includes(status)) await DBOS.rewindWorkflow(workflowId, { queueName: QUEUE });
  });
}

export async function cancelImport(brandId: string, runId: string): Promise<void> {
  const row = await withBrand(brandId, (tx) => run.cancelRun(tx, brandId, runId));
  // Steps also check the run's state, so this only saves the wait for the next step boundary.
  if (row.workflowId) await DBOS.cancelWorkflow(row.workflowId).catch(() => undefined);
}

/** Resumes a failed_retryable run from its failed step; earlier steps, paid calls included, are not run again. */
export async function retryImport(brandId: string, runId: string): Promise<void> {
  const row = await withBrand(brandId, (tx) => run.reopenRun(tx, brandId, runId));
  try {
    const handle = await retryWorkflow(row.workflowId!);
    await withBrand(brandId, (tx) => run.setWorkflow(tx, brandId, runId, handle.workflowID));
  } catch (e) {
    await run.markFailed(brandId, runId, e);
    throw e;
  }
}
