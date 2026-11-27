import { DBOS, type WorkflowHandle } from '@dbos-inc/dbos-sdk';
import { eq } from 'drizzle-orm';
import { AiError } from '../ai/index.ts';
import { config } from '../config.ts';
import { isUniqueViolation } from '../db/client.ts';
import { runStates } from '../db/schema/core.ts';
import { planRuns } from '../db/schema/plan.ts';
import { watchRuns } from '../db/schema/research.ts';
import { studioRuns } from '../db/schema/studio.ts';
import { withBrand, type Tx } from '../db/tenant.ts';
import { audit } from '../domain/audit/index.ts';
import { ConflictError, HttpError } from '../http/errors.ts';
import { logger } from '../log.ts';

/** Appendix B run states, stored in every run table's `state` column (runColumns). */
export type RunState = (typeof runStates)[number];
export { runStates };

/**
 * What a failed run shows the owner: the message of an error meant for them (an HttpError or an AiError), else a
 * plain sentence, with the error itself logged. A database error's message holds its SQL and parameters.
 */
export function runError(e: unknown): string {
  if (e instanceof HttpError || e instanceof AiError) return e.message;
  logger.error({ err: e }, 'run failed on an unexpected error');
  return 'The run stopped on an unexpected error; retry it';
}

/**
 * True when retrying cannot help: an answer the model will not change (a refusal, off-schema output) or a bad request.
 * An outage, the monthly cap (402) and anything unknown can be retried.
 */
export const isFinal = (e: unknown): boolean => (e instanceof AiError && !e.retryable) || (e instanceof HttpError && e.status !== 402);

/** The one queue. Enqueue with DBOS.startWorkflow(fn, { queueName: QUEUE }). */
export const QUEUE = 'default';

// Fixed so a restarted process recovers the workflows a previous process left unfinished.
// Bump it only with a deliberate migration of in-flight runs.
export const APPLICATION_VERSION = '1';

/**
 * This process's DBOS executor ID. At launch an executor recovers the unfinished workflows recorded under its own
 * ID, so two processes must never share one: each pm2 cluster instance is api-<NODE_APP_INSTANCE>, and a single
 * process without pm2 is `local`. After lowering the instance count, recover the removed IDs with DBOS.recoverWorkflows.
 */
export const executorId = (instance = config.NODE_APP_INSTANCE) => (instance === undefined ? 'local' : `api-${instance}`);

/**
 * Launches DBOS against its system database and registers the queue. Workflows must be
 * registered (by importing src/modules.ts) before this runs.
 */
export async function launchWorkflows(systemDatabaseUrl = config.DBOS_SYSTEM_DATABASE_URL, systemDatabasePoolSize?: number): Promise<void> {
  DBOS.setConfig({ name: 'prachaar', systemDatabaseUrl, systemDatabasePoolSize, applicationVersion: APPLICATION_VERSION, executorID: executorId(), logLevel: 'warn' });
  await DBOS.launch();
  await DBOS.registerQueue(QUEUE);
}

export async function shutdownWorkflows(): Promise<void> {
  await DBOS.shutdown();
}

/**
 * Retries a failed workflow from its first failed step: earlier steps keep their stored output and
 * do not run again, so a paid model call is never repeated. Returns the new run's handle.
 */
export async function retryWorkflow<T>(workflowId: string): Promise<WorkflowHandle<T>> {
  const steps = (await DBOS.listWorkflowSteps(workflowId)) ?? [];
  const failed = steps.find((s) => s.error);
  const from = failed?.functionID ?? steps.length;
  return DBOS.forkWorkflow<T>(workflowId, from, { queueName: QUEUE });
}

/** A run table that records its workflow ID: the module's getRun (404 outside the brand) and the names its audit events use. */
export type RunTable = {
  table: typeof planRuns | typeof studioRuns | typeof watchRuns;
  get: (tx: Tx, brandId: string, runId: string) => Promise<{ state: RunState; workflowId: string | null }>;
  /** `<action>.cancel`, `<action>.retry` */
  action: string;
  objectType: string;
};

/** Cancels a running or waiting run: the row and its audit event first, then the workflow. */
export async function cancelRun(t: RunTable, brandId: string, runId: string): Promise<void> {
  const run = await withBrand(brandId, async (tx) => {
    const r = await t.get(tx, brandId, runId);
    if (r.state !== 'running' && r.state !== 'awaiting_approval') throw new ConflictError('This run has already finished');
    await tx.update(t.table).set({ state: 'cancelled', finishedAt: new Date() }).where(eq(t.table.id, runId));
    await audit(tx, { brandId, actor: 'operator', action: `${t.action}.cancel`, objectType: t.objectType, objectId: runId, result: 'ok' });
    return r;
  });
  await DBOS.cancelWorkflow(run.workflowId ?? runId);
}

/**
 * Restarts a failed_retryable run from its first failed step (retryWorkflow); earlier steps and their paid calls are not
 * repeated. `busy` is the 409 message when another run already holds the table's one-active-run slot.
 */
export async function retryRun(t: RunTable, brandId: string, runId: string, busy: string): Promise<void> {
  const run = await withBrand(brandId, async (tx) => {
    const r = await t.get(tx, brandId, runId);
    if (r.state !== 'failed_retryable') throw new ConflictError('Only a run that failed with a retryable error can be retried');
    try {
      await tx.update(t.table).set({ state: 'running', error: null, finishedAt: null }).where(eq(t.table.id, runId));
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictError(busy);
      throw e;
    }
    await audit(tx, { brandId, actor: 'operator', action: `${t.action}.retry`, objectType: t.objectType, objectId: runId, result: 'ok' });
    return r;
  });
  const handle = await retryWorkflow(run.workflowId ?? runId);
  await withBrand(brandId, (tx) => tx.update(t.table).set({ workflowId: handle.workflowID }).where(eq(t.table.id, runId)));
}
