// The owner's actions on a job after its time: confirm a manual post, resolve an unknown one, retry.
import type { Tx } from '../../db/tenant.ts';
import { ConflictError, ValidationError } from '../../http/errors.ts';
import { approvedFacts } from '../knowledge/index.ts';
import { findChannel, httpUrl } from './channels.ts';
import { getJob, ownerAction, type Job } from './jobs.ts';
import { approvalOf, draftOf, reads, type Reads } from './reads.ts';
import { getSettings } from './settings.ts';
import { nextState } from './state.ts';

const maxAttempts = async (tx: Tx, brandId: string) => (await getSettings(tx, brandId)).maxAttempts;

/** The owner posted it by hand: published with the post's link. A second confirmation is refused and changes nothing. */
export async function confirmManual(tx: Tx, brandId: string, jobId: string, url: string): Promise<Job> {
  const link = httpUrl(url ?? '', 'The post\'s link');
  const job = await getJob(tx, brandId, jobId);
  return ownerAction(tx, brandId, job, { type: 'confirm_manual', url: link }, await maxAttempts(tx, brandId));
}

/** The owner checked the channel: posted (with its link) is published; not posted is sent again with the same key. */
export async function resolveUnknown(tx: Tx, brandId: string, jobId: string, i: { posted: boolean; url?: string }): Promise<Job> {
  if (typeof i.posted !== 'boolean') throw new ValidationError('posted is true or false');
  if (i.posted && !i.url) throw new ValidationError('Give the post\'s link');
  const url = i.posted ? httpUrl(i.url!, 'The post\'s link') : undefined;
  const job = await getJob(tx, brandId, jobId);
  return ownerAction(tx, brandId, job, { type: 'resolve_unknown', posted: i.posted, url }, await maxAttempts(tx, brandId));
}

/**
 * Sends a failed (retryable) or blocked job again at the next check. The gate runs again first: the
 * draft must still be approved with the payload this job was scheduled with, and the channel connected.
 */
export async function retryJob(tx: Tx, brandId: string, jobId: string, rr?: Reads): Promise<Job> {
  const job = await getJob(tx, brandId, jobId);
  const allowed = nextState(job, { type: 'retry' }, 1);
  if (allowed.refused) throw new ConflictError(allowed.refused);
  const r = rr ?? (await reads());
  const facts = await approvedFacts(tx, brandId);
  if (!(await draftOf(r, tx, brandId, job.draftId, facts))) throw new ConflictError('The draft no longer exists: cancel this job');
  const approval = await approvalOf(r, tx, brandId, job.draftId, facts);
  if (!approval) throw new ConflictError('The draft has no valid approval now: approve it again, then schedule it');
  if (approval.payloadHash !== job.payloadHash || approval.objectVersion !== job.draftVersion)
    throw new ConflictError('The draft was approved again since this job was scheduled: cancel it and schedule the new version');
  const channel = await findChannel(tx, brandId, job.channelId);
  if (!channel) throw new ConflictError('The channel was removed: cancel this job');
  if (channel.status !== 'connected') throw new ConflictError(`The channel is ${channel.status === 'disabled' ? 'disabled' : 'waiting to be reconnected'}: ${channel.status === 'disabled' ? 'enable' : 'reconnect'} it first`);
  return ownerAction(tx, brandId, job, { type: 'retry' }, await maxAttempts(tx, brandId));
}
