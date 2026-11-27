// Reading a job and applying a state change to it. The change is decided by nextState; this file only
// writes it, with a conditional update on the state that was read, and audits it.
import { and, eq, type SQL } from 'drizzle-orm';
import { publishChannels, publishJobs } from '../../db/schema/publish.ts';
import { isUuid, type Tx } from '../../db/tenant.ts';
import { ConflictError, NotFoundError } from '../../http/errors.ts';
import { audit } from '../audit/index.ts';
import { safeLink } from './channels.ts';
import { nextState, type JobState, type Outcome } from './state.ts';

export type Job = typeof publishJobs.$inferSelect;

/** When the job is next due: the retry time if one is set, else its scheduled time. */
export const dueAt = (j: Pick<Job, 'scheduledAt' | 'nextAttemptAt'>) => j.nextAttemptAt ?? j.scheduledAt;

async function findJob(tx: Tx, brandId: string, id: string): Promise<Job | null> {
  if (!isUuid(id)) return null;
  const [j] = await tx.select().from(publishJobs).where(and(eq(publishJobs.id, id), eq(publishJobs.brandId, brandId)));
  return j ?? null;
}

export async function getJob(tx: Tx, brandId: string, id: string): Promise<Job> {
  const j = await findJob(tx, brandId, id);
  if (!j) throw new NotFoundError('publish_job', id);
  return j;
}

/** One audit event per state change: the job, its draft version, and its payload hash. */
export function auditJob(tx: Tx, brandId: string, job: Job, action: string, from: JobState | null, to: JobState, note?: string | null, actor = 'operator') {
  return audit(tx, {
    brandId, actor, action: `publish.job.${action}`, objectType: 'publish_job', objectId: job.id, objectVersion: job.draftVersion, result: 'ok',
    reason: JSON.stringify({ from, to, hash: job.payloadHash, ...(note ? { note } : {}) }),
  });
}

type Applied = { job: Job; changed: boolean; refused?: string };

/**
 * Applies nextState's answer to the job as read. The update only lands while the job is still in the
 * state it was read in (and, for a send, still claimed by this worker); otherwise nothing changes.
 */
export async function applyOutcome(
  tx: Tx, brandId: string, job: Job, o: Outcome, opts: { maxAttempts: number; now: Date; actor?: string; claim?: string },
): Promise<Applied> {
  const n = nextState(job, o, opts.maxAttempts);
  if (n.refused) return { job, changed: false, refused: n.refused };
  const set: Partial<Job> = {
    state: n.state,
    error: n.error ?? null,
    retryable: n.retryable ?? false,
    nextAttemptAt: n.retryInSeconds === undefined ? null : new Date(opts.now.getTime() + n.retryInSeconds * 1000),
  };
  if (n.published) Object.assign(set, { externalId: n.published.externalId, externalUrl: safeLink(n.published.url), manual: n.published.manual, publishedAt: opts.now });
  if (o.type === 'reschedule') set.scheduledAt = o.at;
  const where: SQL[] = [eq(publishJobs.id, job.id), eq(publishJobs.brandId, brandId), eq(publishJobs.state, job.state)];
  if (opts.claim) where.push(eq(publishJobs.workflowId, opts.claim));
  const [row] = await tx.update(publishJobs).set(set).where(and(...where)).returning();
  if (!row) return { job: (await findJob(tx, brandId, job.id)) ?? job, changed: false, refused: 'The job changed meanwhile; reload it' };
  if (n.channelStatus) await tx.update(publishChannels).set({ status: n.channelStatus }).where(and(eq(publishChannels.id, job.channelId), eq(publishChannels.brandId, brandId)));
  await auditJob(tx, brandId, row, o.type, job.state, n.state, n.error, opts.actor);
  return { job: row, changed: true };
}

/** An owner's action: applied, or refused with a ConflictError that names why. */
export async function ownerAction(tx: Tx, brandId: string, job: Job, o: Outcome, maxAttempts: number): Promise<Job> {
  const r = await applyOutcome(tx, brandId, job, o, { maxAttempts, now: new Date() });
  if (r.refused) throw new ConflictError(r.refused);
  return r.job;
}
