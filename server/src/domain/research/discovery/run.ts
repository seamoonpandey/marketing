import { and, desc, eq } from 'drizzle-orm';
import { discoveryRuns } from '../../../db/schema/research.ts';
import { isUuid, type Tx } from '../../../db/tenant.ts';
import { NotFoundError } from '../../../http/errors.ts';
import { cancelRun, retryRun, type RunTable } from '../../../workflows/index.ts';

export type DiscoveryRun = typeof discoveryRuns.$inferSelect;

const ACTIVE_MESSAGE = 'A discovery run is already in progress for this brand';

/** Creates the run awaiting approval with its estimate and queues its workflow (the workflow ID is the run ID). */
export async function createDiscovery(brandId: string, keywords: string[]): Promise<{ runId: string }> {
  throw new Error('not built: createDiscovery');
}

export async function getDiscovery(tx: Tx, brandId: string, runId: string): Promise<DiscoveryRun> {
  const [row] = isUuid(runId)
    ? await tx.select().from(discoveryRuns).where(and(eq(discoveryRuns.id, runId), eq(discoveryRuns.brandId, brandId)))
    : [];
  if (!row) throw new NotFoundError('discovery_run', runId);
  return row;
}

export async function listDiscoveries(tx: Tx, brandId: string): Promise<DiscoveryRun[]> {
  return tx.select().from(discoveryRuns).where(eq(discoveryRuns.brandId, brandId)).orderBy(desc(discoveryRuns.createdAt)).limit(50);
}

/** The owner accepts the estimate of a run waiting at awaiting_approval. */
export async function confirmDiscovery(brandId: string, runId: string): Promise<void> {
  throw new Error('not built: confirmDiscovery');
}

const RUNS: RunTable = { table: discoveryRuns, get: getDiscovery, action: 'research.discovery', objectType: 'discovery_run' };
export const cancelDiscovery = (brandId: string, runId: string) => cancelRun(RUNS, brandId, runId);
/** Restarts a failed run from its first failed step; earlier steps (and their paid calls) are not repeated. */
export const retryDiscovery = (brandId: string, runId: string) => retryRun(RUNS, brandId, runId, ACTIVE_MESSAGE);
