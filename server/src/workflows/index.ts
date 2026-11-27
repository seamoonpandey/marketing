import { DBOS, type WorkflowHandle } from '@dbos-inc/dbos-sdk';
import { AiError } from '../ai/index.ts';
import { config } from '../config.ts';
import { runStates } from '../db/schema/core.ts';
import { HttpError } from '../http/errors.ts';
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
