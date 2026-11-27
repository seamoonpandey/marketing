// The read side: jobs as the screens show them, the dashboard, the calendar, scheduling choices and one job.
import type { z } from '@hono/zod-openapi';
import { and, asc, count, desc, eq, gte, inArray, lt, notInArray, sql } from 'drizzle-orm';
import type * as C from '../../contracts/publish.ts';
import type { ApprovedFact } from '../../contracts/common.ts';
import { auditEvents } from '../../db/schema/core.ts';
import { jobStates, publishChannels, publishJobs } from '../../db/schema/publish.ts';
import { tenantOf, type Tx } from '../../db/tenant.ts';
import { ValidationError } from '../../http/errors.ts';
import { brandPrefix, presignDownload, underPrefix } from '../../storage/index.ts';
import { getBrand } from '../brands/index.ts';
import { findChannel, listChannels, type Channel } from './channels.ts';
import { captionLength, copiesOf, fits, isVideo } from './fit.ts';
import { dueAt, getJob, type Job } from './jobs.ts';
import { jobPackage } from './package.ts';
import { approvalOf, type DraftForPublish, type Reads } from './reads.ts';
import { parseInstant, safeTimezone } from './schedule.ts';
import { getSettings } from './settings.ts';
import { allowedActions, type JobState } from './state.ts';

type JobView = z.infer<typeof C.Job>;
const iso = (d: Date | null) => (d ? d.toISOString() : null);
const INACTIVE = ['published', 'cancelled', 'failed'] as const; // the states that free the one-active-job slot

/** The start of the draft's first caption. */
export function excerptOf(d: DraftForPublish | undefined): string | null {
  const c = d && copiesOf(d.content)[0]?.caption;
  if (!c) return d ? '' : null;
  const chars = [...c];
  return chars.length > 140 ? `${chars.slice(0, 139).join('')}…` : c;
}

function toJobView(j: Job, channel: Channel | undefined, draft: DraftForPublish | undefined): JobView {
  return {
    id: j.id, draftId: j.draftId, draftVersion: j.draftVersion, payloadHash: j.payloadHash, channelId: j.channelId,
    channel: channel ? { id: channel.id, platform: channel.platform, accountName: channel.accountName, mode: channel.mode, status: channel.status } : null,
    kind: draft?.kind ?? null, excerpt: excerptOf(draft), scheduledAt: j.scheduledAt.toISOString(), dueAt: dueAt(j).toISOString(),
    state: j.state, attempts: j.attempts, error: j.error, retryable: j.retryable, externalId: j.externalId, externalUrl: j.externalUrl,
    publishedAt: iso(j.publishedAt), manual: j.manual, actions: allowedActions(j), createdAt: j.createdAt.toISOString(),
  };
}

/** Views of several jobs with one read of the channels and one of Studio's drafts. */
export async function jobViews(tx: Tx, brandId: string, jobs: Job[], r: Reads, facts: ApprovedFact[]): Promise<JobView[]> {
  if (!jobs.length) return [];
  const channels = new Map((await listChannels(tx, brandId)).map((c) => [c.id, c]));
  const drafts = new Map((await r.listDrafts(tx, brandId, facts)).map((d) => [d.id, d]));
  return jobs.map((j) => toJobView(j, channels.get(j.channelId), drafts.get(j.draftId)));
}

const timezoneOf = async (tx: Tx, brandId: string) => safeTimezone((await getBrand(tx, brandId)).timezone);
const due = sql`coalesce(${publishJobs.nextAttemptAt}, ${publishJobs.scheduledAt})`;

export async function listJobs(tx: Tx, brandId: string, q: { from?: string; to?: string; state?: JobState }, r: Reads, facts: ApprovedFact[]) {
  const from = q.from ? parseInstant(q.from).at : new Date();
  const to = q.to ? parseInstant(q.to).at : new Date(from.getTime() + 7 * 86_400_000);
  if (to <= from) throw new ValidationError('to must be after from');
  if (to.getTime() - from.getTime() > 62 * 86_400_000) throw new ValidationError('A range is at most 62 days');
  const jobs = await tx.select().from(publishJobs)
    .where(and(eq(publishJobs.brandId, brandId), gte(publishJobs.scheduledAt, from), lt(publishJobs.scheduledAt, to), q.state ? eq(publishJobs.state, q.state) : undefined))
    .orderBy(asc(publishJobs.scheduledAt), asc(publishJobs.id))
    .limit(1000);
  return { timezone: await timezoneOf(tx, brandId), jobs: await jobViews(tx, brandId, jobs, r, facts) };
}

export async function summary(tx: Tx, brandId: string, r: Reads, facts: ApprovedFact[], now = new Date()): Promise<z.infer<typeof C.Summary>> {
  const where = (...states: JobState[]) => and(eq(publishJobs.brandId, brandId), inArray(publishJobs.state, states));
  const counted = await tx.select({ state: publishJobs.state, n: count() }).from(publishJobs).where(eq(publishJobs.brandId, brandId)).groupBy(publishJobs.state);
  const [manualNow, attention, upcoming, published] = [
    await tx.select().from(publishJobs).where(where('awaiting_manual')).orderBy(asc(publishJobs.scheduledAt)).limit(50),
    await tx.select().from(publishJobs).where(where('blocked', 'unknown', 'failed')).orderBy(asc(publishJobs.scheduledAt)).limit(50),
    await tx.select().from(publishJobs).where(and(where('scheduled', 'publishing'), lt(due, new Date(now.getTime() + 7 * 86_400_000)))).orderBy(asc(due)).limit(100),
    await tx.select().from(publishJobs).where(where('published')).orderBy(desc(publishJobs.publishedAt)).limit(10),
  ];
  const views = await jobViews(tx, brandId, [...manualNow, ...attention, ...upcoming, ...published], r, facts);
  const take = (n: number, skip: number) => views.slice(skip, skip + n);
  const hasChannels = (await tx.select({ id: publishChannels.id }).from(publishChannels).where(eq(publishChannels.brandId, brandId)).limit(1)).length > 0;
  return {
    timezone: await timezoneOf(tx, brandId), now: now.toISOString(), hasChannels,
    counts: Object.fromEntries(jobStates.map((s) => [s, counted.find((c) => c.state === s)?.n ?? 0])) as z.infer<typeof C.Counts>,
    manualNow: take(manualNow.length, 0),
    attention: take(attention.length, manualNow.length),
    upcoming: take(upcoming.length, manualNow.length + attention.length),
    published: take(published.length, manualNow.length + attention.length + upcoming.length),
  };
}

/** Ready drafts with a valid approval, and for each channel whether the draft can go there and why not. */
export async function schedulable(tx: Tx, brandId: string, r: Reads, facts: ApprovedFact[]): Promise<z.infer<typeof C.Schedulable>> {
  const channels = await listChannels(tx, brandId);
  const prefix = brandPrefix(await tenantOf(tx), brandId);
  const drafts: z.infer<typeof C.SchedulableDraft>[] = [];
  for (const d of await r.listDrafts(tx, brandId, facts, { status: 'ready' })) {
    const approval = await approvalOf(r, tx, brandId, d.id, facts);
    if (!approval || approval.objectVersion !== d.currentVersion) continue;
    const active = new Set(
      (await tx.select({ channelId: publishJobs.channelId }).from(publishJobs)
        .where(and(eq(publishJobs.brandId, brandId), eq(publishJobs.draftId, d.id), notInArray(publishJobs.state, [...INACTIVE])))).map((x) => x.channelId),
    );
    const length = captionLength(d);
    const thumb = d.renders.filter((x) => !isVideo(x) && underPrefix(prefix, x.key)).sort((a, b) => (a.index ?? 0) - (b.index ?? 0))[0];
    drafts.push({
      draftId: d.id, version: d.currentVersion, kind: d.kind, day: d.day, plannedChannel: d.channel, excerpt: excerptOf(d) ?? '',
      thumbnailUrl: thumb ? await presignDownload(thumb.key) : null, approvalExpiresAt: iso(new Date(approval.expiresAt)),
      channels: channels.map((c) => {
        const fit = fits({ draft: d, captionLength: length, platform: c.platform });
        const reason = active.has(c.id) ? 'Already scheduled to this channel'
          : c.status !== 'connected' ? (c.status === 'disabled' ? 'The channel is disabled' : 'The channel needs reconnecting')
          : fit.ok ? null : fit.reason;
        return { channelId: c.id, platform: c.platform, accountName: c.accountName, status: c.status, fits: reason === null, reason };
      }),
    });
  }
  drafts.sort((a, b) => a.day.localeCompare(b.day));
  return { timezone: await timezoneOf(tx, brandId), settings: await getSettings(tx, brandId), drafts };
}

/** The job's audit trail, newest first. */
export async function history(tx: Tx, brandId: string, jobId: string): Promise<z.infer<typeof C.HistoryEvent>[]> {
  const rows = await tx.select().from(auditEvents)
    .where(and(eq(auditEvents.brandId, brandId), eq(auditEvents.objectType, 'publish_job'), eq(auditEvents.objectId, jobId)))
    .orderBy(desc(auditEvents.seq)).limit(100);
  return rows.map((e) => {
    let r: { from?: JobState | null; to?: JobState; note?: string } = {};
    try {
      r = JSON.parse(e.reason ?? '{}');
    } catch {}
    return { at: e.createdAt.toISOString(), action: e.action, result: e.result, from: r.from ?? null, to: r.to ?? null, note: r.note ?? null };
  });
}

export async function jobDetail(tx: Tx, brandId: string, jobId: string, r: Reads, facts: ApprovedFact[]): Promise<z.infer<typeof C.JobDetail>> {
  const job = await getJob(tx, brandId, jobId);
  const channel = await findChannel(tx, brandId, job.channelId);
  const [view] = await jobViews(tx, brandId, [job], r, facts);
  const p = await jobPackage(tx, brandId, job, channel, r, facts);
  return {
    timezone: await timezoneOf(tx, brandId), job: view!, history: await history(tx, brandId, jobId),
    package: { ...p, captions: p.captions.map((c) => ({ language: c.language, caption: c.caption, cta: c.cta, hashtags: c.hashtags })) },
  };
}

/** For the Results module: what went out in a time range, with its link. */
export async function listPublished(tx: Tx, brandId: string, range: { from: Date; to: Date }) {
  return tx
    .select({
      jobId: publishJobs.id, draftId: publishJobs.draftId, draftVersion: publishJobs.draftVersion, channelId: publishJobs.channelId,
      platform: publishChannels.platform, accountName: publishChannels.accountName, externalId: publishJobs.externalId,
      externalUrl: publishJobs.externalUrl, publishedAt: publishJobs.publishedAt, manual: publishJobs.manual,
    })
    .from(publishJobs)
    .leftJoin(publishChannels, eq(publishChannels.id, publishJobs.channelId))
    .where(and(eq(publishJobs.brandId, brandId), eq(publishJobs.state, 'published'), gte(publishJobs.publishedAt, range.from), lt(publishJobs.publishedAt, range.to)))
    .orderBy(asc(publishJobs.publishedAt));
}
