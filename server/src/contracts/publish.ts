// Request and response schemas of /api/brands/{brandId}/publish/…
import { z } from '@hono/zod-openapi';
import { orNull } from './common.ts';
import { channelStatuses, jobStates } from '../db/schema/publish.ts';
import { platforms } from '../domain/publish/capabilities.ts';

const iso = z.string().openapi({ example: '2026-12-01T04:15:00.000Z', description: 'ISO 8601 timestamp, UTC' });
const at = z.string().openapi({
  example: '2026-12-01T10:00:00+05:45',
  description:
    'ISO 8601 with an offset. A time with no offset is refused. A numeric offset must be the brand timezone\'s offset at that moment, which refuses a wall-clock time that does not exist (a daylight-saving gap); Z (UTC) is always accepted.',
});
const timezone = z.string().openapi({ example: 'Asia/Kathmandu', description: 'The brand\'s IANA timezone; every time on screen is shown in it and names it. UTC when the brand\'s timezone is not valid.' });

export const Platform = z.enum(platforms).openapi('PublishPlatform');
export const JobState = z.enum(jobStates).openapi('PublishJobState', {
  description:
    'scheduled: waiting for its time. publishing: a send is in flight. awaiting_manual: post it by hand now and confirm. published: sent, with its link. unknown: the send timed out; nothing is retried until it is resolved. blocked: the approval or the channel said no at send time, or it missed its time by over 24 hours. failed: sending failed (see retryable). cancelled: stopped by the owner.',
});
export const ChannelStatus = z.enum(channelStatuses).openapi('PublishChannelStatus');

// ---------- channels and capabilities
export const Channel = z
  .object({
    id: z.string(), platform: Platform,
    mode: z.enum(['manual', 'api']).openapi({ description: 'manual: the owner posts by hand at the scheduled time. Every channel is manual this sprint.' }),
    connector: z.enum(['manual', 'mock']),
    accountName: z.string(), accountUrl: z.string().nullable(), status: ChannelStatus,
    lastVerifiedAt: iso.nullable(), createdAt: iso,
  })
  .openapi('PublishChannel');
const httpUrl = z.string().trim().max(2000).openapi({ description: 'An http or https URL.', example: 'https://www.instagram.com/brand' });
export const ChannelCreate = z
  .object({ platform: Platform, accountName: z.string().trim().min(1).max(100), accountUrl: httpUrl.optional() })
  .openapi('PublishChannelCreate', { description: 'Creates a manual channel. One per platform and account name (409).' });
export const ChannelPatch = z
  .object({
    accountName: z.string().trim().min(1).max(100), accountUrl: httpUrl.nullable(),
    status: z.enum(['connected', 'disabled']).openapi({ description: 'connected also reconnects a channel that needs it. Jobs of a channel that is not connected at send time are blocked.' }),
  })
  .partial()
  .openapi('PublishChannelPatch');
export const Capability = z
  .object({
    platform: Platform, textLimit: z.number().int().nullable().openapi({ description: 'Characters, counting the caption, call to action and hashtags; null for none.' }),
    ratios: z.array(z.string()).openapi({ description: 'Accepted image shapes, preferred first.' }), maxMedia: z.number().int(),
    lastVerified: z.string().nullable(), verified: z.boolean().openapi({ description: 'False until the values are checked against the platform. Show "not yet verified".' }),
    manualFallback: z.boolean(),
  })
  .openapi('PublishCapability');

// ---------- settings
export const Settings = z
  .object({
    windowStart: z.number().int().min(0).max(23), windowEnd: z.number().int().min(1).max(24),
    maxAttempts: z.number().int().min(1).max(5).openapi({ description: 'Sends tried on server errors and rate limits before the job fails.' }),
  })
  .openapi('PublishSettings', { description: 'A post may be scheduled from windowStart:00 up to, not including, windowEnd:00 in the brand\'s timezone. windowStart is before windowEnd.' });

// ---------- jobs
export const JobActions = z
  .object({ cancel: z.boolean(), reschedule: z.boolean(), retry: z.boolean(), confirmManual: z.boolean(), resolveUnknown: z.boolean() })
  .openapi('PublishJobActions', { description: 'What the job\'s state allows now. Show only these actions.' });
export const JobChannel = z
  .object({ id: z.string(), platform: Platform, accountName: z.string(), mode: z.enum(['manual', 'api']), status: ChannelStatus })
  .openapi('PublishJobChannel');
export const Job = z
  .object({
    id: z.string(), draftId: z.string(), draftVersion: z.number().int(), payloadHash: z.string(),
    channelId: z.string(), channel: orNull(JobChannel).openapi({ description: 'null when the channel was removed.' }),
    kind: z.string().nullable().openapi({ description: 'The draft\'s kind (post, static, carousel, video); null when Studio no longer has the draft.' }),
    excerpt: z.string().nullable().openapi({ description: 'The start of the draft\'s first caption, up to 140 characters.' }),
    scheduledAt: iso, dueAt: iso.openapi({ description: 'When it is next sent: the retry time after a rate limit or server error, else scheduledAt.' }),
    state: JobState, attempts: z.number().int(),
    error: z.string().nullable().openapi({ description: 'Why it is blocked, failed or unknown, in plain words.' }),
    retryable: z.boolean(), externalId: z.string().nullable(), externalUrl: z.string().nullable().openapi({ description: 'The post\'s link once published.' }),
    publishedAt: iso.nullable(), manual: z.boolean().openapi({ description: 'Posted by hand and confirmed by the owner.' }),
    actions: JobActions, createdAt: iso,
  })
  .openapi('PublishJob');
export const JobList = z.object({ timezone, jobs: z.array(Job).openapi({ description: 'By scheduledAt, earliest first.' }) }).openapi('PublishJobList');
export const JobsQuery = z.object({
  from: z.string().optional().openapi({ description: 'ISO 8601 with an offset; default now. Jobs with scheduledAt at or after it.' }),
  to: z.string().optional().openapi({ description: 'ISO 8601 with an offset; default from + 7 days. Jobs with scheduledAt before it. At most 62 days after from.' }),
  state: JobState.optional(),
});
export const JobCreate = z
  .object({ draftId: z.string(), channelId: z.string(), scheduledAt: at })
  .openapi('PublishJobCreate', {
    description:
      'One job per channel: post once per channel to schedule a draft to several. Refused with 400 for a time with no offset, in the past or outside the publishing window; 409 when the draft has no valid approval or it expires before that time, the channel is not connected, the draft does not fit the platform, or the draft already has an active job on that channel.',
  });
export const Reschedule = z.object({ scheduledAt: at }).openapi('PublishReschedule', { description: 'The same checks as scheduling, approval included.' });
export const ConfirmManual = z
  .object({ url: z.string().trim().max(2000).openapi({ description: 'The post\'s http or https link.' }) })
  .openapi('PublishConfirmManual', { description: 'From awaiting_manual (or failed, posted by hand instead): sets published. A second confirmation is refused with 409 and changes nothing.' });
export const ResolveUnknown = z
  .object({ posted: z.boolean(), url: z.string().trim().max(2000).optional().openapi({ description: 'Required when posted is true.' }) })
  .openapi('PublishResolveUnknown', { description: 'posted true: published with this link. posted false: sent again now, with the same idempotency key so the platform cannot post it twice.' });

export const HistoryEvent = z
  .object({
    at: iso, action: z.string().openapi({ example: 'publish.job.blocked' }), result: z.enum(['ok', 'denied', 'failed']),
    from: orNull(JobState), to: orNull(JobState), note: z.string().nullable(),
  })
  .openapi('PublishHistoryEvent');
export const PackageCaption = z
  .object({
    language: z.string(), caption: z.string().openapi({ description: 'The caption, without the call to action or hashtags.' }),
    cta: z.string(), hashtags: z.array(z.string()).openapi({ description: 'With the leading #.' }),
  })
  .openapi('PublishPackageCaption');
export const PackageMedia = z
  .object({
    index: z.number().int(), ratio: z.string(), kind: z.enum(['image', 'video']), width: z.number().int(), height: z.number().int(),
    filename: z.string(), url: z.string().openapi({ description: 'Presigned download URL, valid for about 15 minutes.' }),
  })
  .openapi('PublishPackageMedia');
export const Package = z
  .object({
    available: z.boolean().openapi({ description: 'False when the approval no longer matches what was scheduled, or the draft is gone: then nothing is shown to post.' }),
    reason: z.string().nullable(), ratio: z.string().nullable().openapi({ description: 'The shape the media are in, chosen for the channel\'s platform.' }),
    captions: z.array(PackageCaption).openapi({ description: 'One per language.' }), media: z.array(PackageMedia).openapi({ description: 'In posting order.' }),
  })
  .openapi('PublishPackage');
export const JobDetail = z
  .object({ timezone, job: Job, history: z.array(HistoryEvent).openapi({ description: 'Newest first.' }), package: Package })
  .openapi('PublishJobDetail');

// ---------- scheduling
export const SchedulableChannel = z
  .object({
    channelId: z.string(), platform: Platform, accountName: z.string(), status: ChannelStatus,
    fits: z.boolean(), reason: z.string().nullable().openapi({ description: 'Why this draft cannot go to this channel: not connected, too long, no image in an accepted shape, too many images, or already scheduled there.' }),
  })
  .openapi('PublishSchedulableChannel');
export const SchedulableDraft = z
  .object({
    draftId: z.string(), version: z.number().int(), kind: z.string(), day: z.string().openapi({ description: 'The planned day, YYYY-MM-DD.' }),
    plannedChannel: z.string(), excerpt: z.string(), thumbnailUrl: z.string().nullable().openapi({ description: 'Presigned URL of the first image, or null.' }),
    approvalExpiresAt: iso.nullable(), channels: z.array(SchedulableChannel).openapi({ description: 'Every channel of the brand.' }),
  })
  .openapi('PublishSchedulableDraft');
export const Schedulable = z
  .object({ timezone, settings: Settings, drafts: z.array(SchedulableDraft).openapi({ description: 'Ready drafts with a valid approval, by planned day.' }) })
  .openapi('PublishSchedulable');

// ---------- dashboard
export const Counts = z.object(Object.fromEntries(jobStates.map((s) => [s, z.number().int()])) as Record<(typeof jobStates)[number], z.ZodNumber>).openapi('PublishCounts');
export const Summary = z
  .object({
    timezone, now: iso, hasChannels: z.boolean(), counts: Counts,
    manualNow: z.array(Job).openapi({ description: 'awaiting_manual: post these by hand now. Earliest first.' }),
    attention: z.array(Job).openapi({ description: 'blocked, unknown and failed, each with its error and actions. Earliest first, at most 50.' }),
    upcoming: z.array(Job).openapi({ description: 'scheduled or publishing in the next seven days. Earliest first.' }),
    published: z.array(Job).openapi({ description: 'The last ten published, newest first.' }),
  })
  .openapi('PublishSummary');
