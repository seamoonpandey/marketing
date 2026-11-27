// Owned by the approve branch (docs/structure.md). Request and response schemas of
// /api/brands/{brandId}/approve/…
import { z } from '@hono/zod-openapi';
import { orNull } from './common.ts';
import { Content, Finding, Kind, LeftOut } from './studio.ts';

const iso = z.string().openapi({ example: '2026-11-27T06:00:00.000Z', description: 'ISO 8601 timestamp' });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).openapi({ example: '2026-11-29', description: 'A calendar date, YYYY-MM-DD' });
const hash = z.string().regex(/^[0-9a-f]{64}$/).openapi({ description: 'The payloadHash the queue or the preview returned, sent back unchanged.' });

export const State = z.enum(['waiting', 'approved', 'rejected', 'invalid', 'expired', 'paused']).openapi('ApproveState', {
  description:
    'Worked out on every read, never stored. waiting: ready, no decision for its current version. approved: valid now. rejected: rejected for its current version. ' +
    'invalid: approved, but the payload changed, the draft is no longer ready or gone, a cited fact is no longer approved, a used asset lost its rights, Studio now reports a blocking issue, or the draft turned high risk after a bulk or note-less approval. ' +
    'expired: approved, past its expiry. paused: approved and otherwise valid while the brand is paused.',
});
export const Risk = z.enum(['low', 'medium', 'high']).openapi('ApproveRisk', {
  description: 'high needs a review note of at least 20 characters and never joins a bulk approval.',
});

export const Decision = z
  .object({
    id: z.string(), draftId: z.string(), version: z.number().int().openapi({ description: 'The draft version decided on.' }),
    decision: z.enum(['approved', 'rejected']), payloadHash: z.string(), risk: Risk,
    reason: z.string().nullable().openapi({ description: 'The rejection reason; null for an approval.' }),
    reviewNote: z.string().nullable(), decidedBy: z.string(), decidedAt: iso,
    expiresAt: iso.nullable().openapi({ description: 'When an approval stops being valid; null for a rejection.' }),
    bulkId: z.string().nullable().openapi({ description: 'Shared by every approval of one bulk approval.' }),
  })
  .openapi('ApproveDecision', {
    description:
      'A decision is never edited; the newest one on the current version counts. On one version: an approval that expired or became invalid can be approved again (renewed, ' +
      'with every check), an approval can be withdrawn by a rejection, and a rejected version can be approved after all.',
  });

export const Counts = z
  .object({
    waiting: z.number().int(), approved: z.number().int(), rejected: z.number().int(),
    invalid: z.number().int(), expired: z.number().int(), paused: z.number().int(),
  })
  .openapi('ApproveCounts');
export const Summary = z
  .object({
    counts: Counts, paused: z.boolean(), pausedReason: z.string().nullable(), pausedAt: iso.nullable(),
    monthDecisions: z.number().int().openapi({ description: 'Approvals and rejections recorded this calendar month (UTC).' }),
  })
  .openapi('ApproveSummary');

// ---------- queue
export const QueueDraft = z
  .object({
    version: z.number().int().openapi({ description: 'The current version.' }), kind: Kind, status: z.enum(['draft', 'ready']),
    channel: z.string(), day: day.openapi({ description: 'The day it is planned to go out.' }),
    weekStart: day.openapi({ description: "The first day of the brand's plan week holding day. A bulk approval stays inside one." }),
    excerpt: z.string().openapi({ description: 'The start of the first caption, at most 140 characters.' }),
    thumbnailUrl: z.string().nullable().openapi({ description: 'Presigned URL of the first rendered image; null when there is none.' }),
    risk: Risk, riskReasons: z.array(z.string()),
    payloadHash: z.string().nullable().openapi({ description: 'Hash of the exact payload; null while the draft is not ready.' }),
    blockingCount: z.number().int(),
    viewed: z.boolean().openapi({ description: 'This exact payload has been opened in the preview. A bulk approval needs it.' }),
    canApprove: z.boolean(), cannotApproveReason: z.string().nullable(),
    noteRequired: z.boolean().openapi({ description: 'True for high risk: approving needs a review note of at least 20 characters.' }),
    bulkReason: z.string().nullable().openapi({
      description: 'Why this item cannot join any bulk approval, or null. Items that can still join only others with the same channel, risk and weekStart.',
    }),
  })
  .openapi('ApproveQueueDraft');
export const QueueItem = z
  .object({
    draftId: z.string(), state: State, stateReason: z.string().nullable(),
    draft: orNull(QueueDraft).openapi({ description: 'null when Studio no longer has the draft: only its decisions remain.' }),
    latest: orNull(Decision).openapi({ description: 'The newest decision, of any version.' }),
  })
  .openapi('ApproveQueueItem');
export const QueueQuery = z.object({ state: State.optional() });
export const Queue = z
  .object({
    summary: Summary.openapi({ description: 'Counts over the whole queue, whatever the state filter.' }),
    items: z.array(QueueItem).openapi({
      description: 'Ready drafts and drafts with a decision, by day, then risk (high first). Drafts Studio no longer has come last.',
    }),
  })
  .openapi('ApproveQueue');

// ---------- preview
export const FactRef = z
  .object({
    id: z.string(), section: z.string(), subjectName: z.string().nullable(), field: z.string(), value: z.unknown(), unit: z.string().nullable(),
    expiresAt: iso.nullable(),
  })
  .openapi('ApproveFactRef', { description: 'A cited fact that is approved today.' });
export const Render = z
  .object({
    ratio: z.string(), width: z.number().int(), height: z.number().int(), overflow: z.boolean(),
    index: z.number().int().openapi({ description: 'The slide or scene number, from 0. A video is index 0.' }),
    type: z.enum(['image', 'video']),
    url: z.string().openapi({ description: 'Presigned download URL, valid for about 15 minutes. Images open inline; a video is an attachment.' }),
  })
  .openapi('ApproveRender');
export const PreviewDraft = z
  .object({
    version: z.number().int(), kind: Kind, status: z.enum(['draft', 'ready']), channel: z.string(), day, weekStart: day,
    pillar: z.string().nullable(), campaignId: z.string().nullable(),
    content: Content.openapi({ description: "The current version's copy in each language, slide text or scenes, template and ratios." }),
    leftOut: z.array(LeftOut), findings: z.array(Finding).openapi({ description: 'Blocking first.' }), blockingCount: z.number().int(),
    facts: z.array(FactRef), missingFactIds: z.array(z.string()).openapi({ description: 'Cited facts that are not approved today.' }),
    renders: z.array(Render).openapi({ description: 'Every file of the current version, in the order Studio keeps them.' }),
    risk: Risk, riskReasons: z.array(z.string()),
    payloadHash: z.string().nullable().openapi({ description: 'Send it back to approve or reject; null while the draft is not ready.' }),
    expiresIfApproved: iso.nullable().openapi({ description: 'The expiry an approval given now would get; null while it cannot be approved.' }),
    noteRequired: z.boolean(), canApprove: z.boolean(), cannotApproveReason: z.string().nullable(),
    canReject: z.boolean(), cannotRejectReason: z.string().nullable(),
  })
  .openapi('ApprovePreviewDraft');
export const Preview = z
  .object({
    draftId: z.string(), state: State, stateReason: z.string().nullable(),
    paused: z.boolean().openapi({ description: 'The brand is paused: an approval given now is stored but not valid until resumed.' }),
    draft: orNull(PreviewDraft).openapi({ description: 'null when Studio no longer has the draft: only its decisions remain.' }),
    history: z.array(Decision).openapi({ description: 'Every decision on this draft, newest first.' }),
  })
  .openapi('ApprovePreview', { description: 'The exact version that would go out. Reading it records that this payload was viewed.' });

// ---------- decisions
export const ApproveBody = z
  .object({
    payloadHash: hash,
    reviewNote: z.string().max(2000).optional().openapi({ description: 'Required for high risk: at least 20 characters, not counting spaces at the ends or invisible characters.' }),
  })
  .openapi('ApproveApprove');
export const RejectBody = z.object({ payloadHash: hash, reason: z.string().trim().min(1).max(1000) }).openapi('ApproveReject');
export const BulkBody = z
  .object({ items: z.array(z.object({ draftId: z.string(), payloadHash: hash })).min(1).max(50) })
  .openapi('ApproveBulk', {
    description: 'Every item must be waiting, not high risk, opened in the preview at this payload, and share one channel, one risk and one weekStart. One failure approves none.',
  });
export const BulkResult = z.object({ bulkId: z.string(), decisions: z.array(Decision) }).openapi('ApproveBulkResult');

// ---------- settings
export const Settings = z
  .object({
    maxAgeDays: z.number().int().min(1).max(90).openapi({ description: 'How many days an approval stays valid at most. Default 14.' }),
    approvers: z.array(z.string().trim().min(1).max(100)).max(20).openapi({ description: 'Names of the people who approve.' }),
  })
  .openapi('ApproveSettings');
export const SettingsView = Settings.extend({ paused: z.boolean(), pausedReason: z.string().nullable(), pausedAt: iso.nullable() }).openapi('ApproveSettingsView');
export const PauseBody = z.object({ reason: z.string().trim().min(1).max(500) }).openapi('ApprovePause');
