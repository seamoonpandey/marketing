// Scheduling a draft to a channel. Times are stored and compared in UTC; the brand's timezone is used
// only to check the publishing window and to describe a time.
import { randomUUID } from 'node:crypto';
import type { ApprovedFact } from '../../contracts/common.ts';
import { publishJobs } from '../../db/schema/publish.ts';
import type { Tx } from '../../db/tenant.ts';
import { ConflictError, NotFoundError, ValidationError } from '../../http/errors.ts';
import { getBrand } from '../brands/index.ts';
import { approvedFacts } from '../knowledge/index.ts';
import { getChannel, type Channel } from './channels.ts';
import { captionLength, fits } from './fit.ts';
import { auditJob, getJob, ownerAction, type Job } from './jobs.ts';
import { approvalOf, draftOf, reads, type DraftForPublish, type GateApproval, type Reads } from './reads.ts';
import { getSettings, type PublishSettings } from './settings.ts';
import { nextState } from './state.ts';

const AT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|([+-])(\d{2}):(\d{2}))$/i;

/** The UTC offset of a timezone at an instant, in minutes; null when the timezone is not valid. */
export function offsetAt(timezone: string, at: Date): number | null {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'longOffset' }).formatToParts(at).find((p) => p.type === 'timeZoneName')!.value;
    const m = /^GMT(?:([+-])(\d{2}):(\d{2}))?$/.exec(name);
    return m ? (m[1] ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0) : null;
  } catch {
    return null;
  }
}

/** The timezone if valid, else UTC, so one brand's bad timezone never breaks a screen. */
export const safeTimezone = (tz: string) => (offsetAt(tz, new Date()) === null ? 'UTC' : tz);

const fmtOffset = (m: number) => `${m < 0 ? '-' : '+'}${String(Math.floor(Math.abs(m) / 60)).padStart(2, '0')}:${String(Math.abs(m) % 60).padStart(2, '0')}`;

/** "2026-12-01 23:00 Asia/Kathmandu": a time as the brand reads it. */
export function describeAt(at: Date, timezone: string): string {
  const tz = safeTimezone(timezone);
  const local = new Date(at.getTime() + offsetAt(tz, at)! * 60_000).toISOString();
  return `${local.slice(0, 10)} ${local.slice(11, 16)} ${tz}`;
}

/**
 * Parses a time that must carry an offset. A numeric offset must be the brand timezone's offset at that
 * instant, so a wall-clock time inside a daylight-saving gap (or a wrong offset) is refused; Z is a plain
 * UTC instant and always accepted.
 */
export function parseAt(s: string, timezone: string): Date {
  const m = AT.exec(s.trim());
  if (!m) throw new ValidationError(`"${s}" needs a date, a time and an offset, such as 2026-12-01T10:00:00+05:45`);
  const [, y, mo, d, h, mi, sec = '0', ms = '0', , sign, oh, om] = m;
  const wall = Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!, +sec, +ms.padEnd(3, '0'));
  const w = new Date(wall);
  if (w.getUTCFullYear() !== +y! || w.getUTCMonth() !== +mo! - 1 || w.getUTCDate() !== +d! || w.getUTCHours() !== +h! || w.getUTCMinutes() !== +mi! || +sec > 59)
    throw new ValidationError(`"${s}" is not a real date and time`);
  const offset = sign ? (sign === '-' ? -1 : 1) * (+oh! * 60 + +om!) : null;
  if (offset !== null && (+oh! > 14 || +om! > 59)) throw new ValidationError(`"${s}" has an impossible offset`);
  const at = new Date(wall - (offset ?? 0) * 60_000);
  const tzOffset = offsetAt(timezone, at);
  if (tzOffset === null) throw new ValidationError(`The brand's timezone "${timezone}" is not valid: fix it in the brand settings first`);
  if (offset !== null && offset !== tzOffset)
    throw new ValidationError(
      `${s} does not exist in ${timezone}: its offset at that moment is ${fmtOffset(tzOffset)}, not ${fmtOffset(offset)} (a daylight-saving change?). Use the brand's offset, or UTC with Z`,
    );
  return at;
}

/** Refuses a time in the past or outside the publishing window in the brand's timezone. */
export function checkWindow(at: Date, timezone: string, s: PublishSettings, now: Date): void {
  if (at.getTime() < now.getTime()) throw new ValidationError(`${describeAt(at, timezone)} is in the past`);
  const local = new Date(at.getTime() + offsetAt(timezone, at)! * 60_000);
  const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
  if (minute < s.windowStart * 60 || minute >= s.windowEnd * 60)
    throw new ValidationError(`${describeAt(at, timezone)} is outside the publishing hours, ${s.windowStart}:00 to ${s.windowEnd}:00`);
}

type Checked = { at: Date; channel: Channel; draft: DraftForPublish; approval: GateApproval; settings: PublishSettings };

/** Every check scheduling makes, in the order an owner would want to hear them. */
async function check(tx: Tx, brandId: string, i: { draftId: string; channelId: string; scheduledAt: string }, facts: ApprovedFact[], r: Reads): Promise<Checked> {
  const [brand, settings] = [await getBrand(tx, brandId), await getSettings(tx, brandId)];
  const at = parseAt(i.scheduledAt, brand.timezone);
  checkWindow(at, brand.timezone, settings, new Date());
  const channel = await getChannel(tx, brandId, i.channelId);
  const draft = await draftOf(r, tx, brandId, i.draftId, facts);
  if (!draft) throw new NotFoundError('draft', i.draftId);
  const approval = await approvalOf(r, tx, brandId, i.draftId, facts);
  if (!approval || approval.objectVersion !== draft.currentVersion) throw new ConflictError('The draft has no valid approval: approve its current version first');
  if (new Date(approval.expiresAt).getTime() < at.getTime())
    throw new ConflictError(`The approval expires at ${describeAt(new Date(approval.expiresAt), brand.timezone)}, before that time`);
  if (channel.status !== 'connected') throw new ConflictError(`The channel is ${channel.status === 'disabled' ? 'disabled' : 'waiting to be reconnected'}`);
  const fit = fits({ draft, captionLength: captionLength(draft), platform: channel.platform });
  if (!fit.ok) throw new ConflictError(fit.reason);
  return { at, channel, draft, approval, settings };
}

/** A job for an approved draft on one channel, bound to the approval's version and payload hash, with its own idempotency key. */
export async function scheduleJob(
  tx: Tx, brandId: string, i: { draftId: string; channelId: string; scheduledAt: string }, facts: ApprovedFact[], rr?: Reads,
): Promise<Job> {
  const r = rr ?? (await reads());
  const c = await check(tx, brandId, i, facts, r);
  // The partial unique index allows one active job per draft and channel; of two racing requests one stores nothing.
  const [job] = await tx
    .insert(publishJobs)
    .values({
      brandId, draftId: c.draft.id, draftVersion: c.approval.objectVersion, payloadHash: c.approval.payloadHash,
      channelId: c.channel.id, scheduledAt: c.at, idempotencyKey: randomUUID(),
    })
    .onConflictDoNothing()
    .returning();
  if (!job) throw new ConflictError('This draft already has an active job on this channel: cancel it first');
  await auditJob(tx, brandId, job, 'schedule', null, 'scheduled', null);
  return job;
}

export async function cancelJob(tx: Tx, brandId: string, jobId: string): Promise<Job> {
  const job = await getJob(tx, brandId, jobId);
  return ownerAction(tx, brandId, job, { type: 'cancel' }, (await getSettings(tx, brandId)).maxAttempts);
}

/** Moves a scheduled or blocked job, with every scheduling check again. The payload must still be the one approved. */
export async function rescheduleJob(tx: Tx, brandId: string, jobId: string, scheduledAt: string, rr?: Reads): Promise<Job> {
  const job = await getJob(tx, brandId, jobId);
  const allowed = nextState(job, { type: 'reschedule', at: new Date() }, 1);
  if (allowed.refused) throw new ConflictError(allowed.refused);
  const r = rr ?? (await reads());
  const c = await check(tx, brandId, { draftId: job.draftId, channelId: job.channelId, scheduledAt }, await approvedFacts(tx, brandId), r).catch((e) => {
    // A removed channel is the job's problem, not a 404 of the job.
    if (e instanceof NotFoundError && e.objectType === 'channel') throw new ConflictError('The channel was removed: cancel this job');
    if (e instanceof NotFoundError && e.objectType === 'draft') throw new ConflictError('The draft no longer exists: cancel this job');
    throw e;
  });
  if (c.approval.payloadHash !== job.payloadHash) throw new ConflictError('The draft was approved again since this job was scheduled: cancel it and schedule the new version');
  return ownerAction(tx, brandId, job, { type: 'reschedule', at: c.at }, c.settings.maxAttempts);
}
