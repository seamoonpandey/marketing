// Owned by the studio branch (docs/structure.md). Request and response schemas of
// /api/brands/{brandId}/studio/…
import { z } from '@hono/zod-openapi';
import { namedMoney, orNull } from './common.ts';
import { channels, formats } from '../domain/plan/enums.ts';
import { draftKinds, ratios, templates } from '../db/schema/studio.ts';

const iso = z.string().openapi({ example: '2026-11-27T06:00:00.000Z', description: 'ISO 8601 timestamp' });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).openapi({ example: '2026-11-29', description: 'A calendar date, YYYY-MM-DD' });
const StudioMoney = namedMoney('StudioMoney');

export const Kind = z.enum(draftKinds).openapi('StudioKind', { description: 'post: copy only. static: one image. carousel: 2 to 10 slides. video: a script and a rendered video.' });
export const Ratio = z.enum(ratios).openapi('StudioRatio');
export const Template = z.enum(templates).openapi('StudioTemplate');
export const DraftStatus = z.enum(['draft', 'ready']).openapi('StudioDraftStatus');

// ---------- content
export const Sentence = z
  .object({
    text: z.string().trim().min(1).max(1000),
    claim: z.boolean().openapi({ description: 'A claim is kept only while it cites at least one approved fact.' }),
    factIds: z.array(z.string()).max(20).default([]),
  })
  .openapi('StudioSentence');
export const Copy = z
  .object({
    language: z.string().trim().min(1).max(10).openapi({ description: 'One of the brand languages.' }),
    sentences: z.array(Sentence).max(30).openapi({ description: 'The caption is these joined with spaces.' }),
    hashtags: z.array(z.string().trim().min(1).max(60)).max(30).default([]).openapi({ description: 'Without the leading #.' }),
    cta: z.string().trim().max(300).default(''),
  })
  .openapi('StudioCopy');
export const SlideText = z
  .object({
    headline: z.string().trim().min(1).max(600),
    subline: z.string().trim().max(600).optional(),
    badge: z.string().trim().max(100).optional(),
    photoAssetId: z.string().optional().openapi({ description: 'An asset of this brand with a licence recorded; any other id is refused with 404.' }),
  })
  .openapi('StudioSlideText');
export const Scene = z
  .object({
    onScreenText: z.string().trim().min(1).max(600), voiceover: z.string().trim().max(1000), shot: z.string().trim().max(500),
    seconds: z.number().min(1).max(15),
  })
  .openapi('StudioScene', { description: 'Each scene becomes one card of the video. There is no voice: voiceover is script text only.' });
export const Content = z
  .object({
    copies: z.array(Copy), slides: z.array(SlideText).openapi({ description: 'static and carousel drafts. Empty for others.' }),
    scenes: z.array(Scene).openapi({ description: 'video drafts. Empty for others.' }), template: Template, ratios: z.array(Ratio),
  })
  .openapi('StudioContent');
export const ContentPatch = z
  .object({
    copies: z.array(Copy).max(10).openapi({ description: 'Replaces the copy of each language listed; languages not listed are kept.' }),
    slides: z.array(SlideText).max(10), scenes: z.array(Scene).max(10), template: Template, ratios: z.array(Ratio).min(1).max(4),
    baseVersion: z.number().int().optional().openapi({ description: 'The version the editor started from; a different current version answers 409 so an edit never overwrites a newer one.' }),
  })
  .partial()
  .openapi('StudioContentPatch', {
    description: 'Every change makes a new version (origin owner), clears the renders of the new version and sets a ready draft back to draft. Claims citing no approved fact move to leftOut.',
  });

// ---------- facts, checks, renders
export const FactRef = z
  .object({ id: z.string(), section: z.string(), subjectName: z.string().nullable(), field: z.string(), value: z.unknown(), unit: z.string().nullable() })
  .openapi('StudioFactRef', { description: 'An approved fact that the draft cites. A cited id missing from the list is not approved today.' });
export const LeftOut = z
  .object({ language: z.string(), text: z.string(), reason: z.string().openapi({ description: '"no approved fact" for a claim that cited nothing usable.' }) })
  .openapi('StudioLeftOut');
export const Check = z
  .enum(['unverified_number', 'prohibited_word', 'too_long', 'missing_cta', 'expired_fact', 'no_rights', 'text_overflow', 'not_rendered', 'low_contrast', 'many_hashtags'])
  .openapi('StudioCheck');
export const Finding = z
  .object({ check: Check, blocking: z.boolean(), where: z.string().openapi({ example: 'caption en' }), message: z.string() })
  .openapi('StudioFinding');
export const Render = z
  .object({
    ratio: Ratio, width: z.number().int(), height: z.number().int(), overflow: z.boolean(),
    index: z.number().int().openapi({ description: 'The slide or scene number, from 0. A video is index 0.' }),
    type: z.enum(['image', 'video']), url: z.string().openapi({ description: 'Presigned download URL, valid for about 15 minutes. Images open inline; a video is an attachment.' }),
  })
  .openapi('StudioRender');

// ---------- runs
export const RunState = z.enum(['running', 'awaiting_approval', 'completed', 'failed_retryable', 'failed_final', 'cancelled']).openapi('StudioRunState');
export const StudioRun = z
  .object({
    id: z.string(), kind: z.enum(['generate', 'render']), targets: z.array(z.string()).openapi({ description: 'Plan item ids (generate) or the draft id (render).' }),
    state: RunState,
    error: z.string().nullable().openapi({ description: 'On a failed run its reason. A completed render run can carry a plain note, such as the video engine being unavailable while the images were kept.' }),
    startedAt: iso.nullable(), finishedAt: iso.nullable(), estimate: orNull(StudioMoney), actual: orNull(StudioMoney),
    counts: z
      .object({
        drafted: z.number().int().optional(), failed: z.number().int().optional(), rendered: z.number().int().optional(),
        failures: z.array(z.object({ planItemId: z.string(), message: z.string() })).optional().openapi({ description: 'Items whose model call failed; retry redoes only these.' }),
        missingLanguages: z.array(z.object({ planItemId: z.string(), languages: z.array(z.string()) })).optional().openapi({ description: 'Brand languages the model returned no copy for; the draft is still stored.' }),
      })
      .openapi('StudioRunCounts'),
    createdAt: iso,
  })
  .openapi('StudioRun');
export const Estimate = z
  .object({ estimate: StudioMoney, remaining: StudioMoney.openapi({ description: 'What the tenant may still spend this month.' }), count: z.number().int() })
  .openapi('StudioEstimate', { description: 'The most the copy for these items can cost. Show it before starting. Rendering costs NPR 0.' });

// ---------- overview
export const PlanItemRef = z
  .object({
    id: z.string(), day, channel: z.enum(channels), format: orNull(z.enum(formats)), idea: z.string(), cta: z.string(),
    kind: Kind.openapi({ description: 'The kind of draft this item gets.' }),
  })
  .openapi('StudioPlanItem');
export const DraftCard = z
  .object({
    id: z.string(), kind: Kind, status: DraftStatus, currentVersion: z.number().int(),
    blockingCount: z.number().int().openapi({ description: 'Blocking findings today; a draft with 0 can be marked ready.' }),
    thumbnailUrl: z.string().nullable().openapi({ description: 'First rendered image, or null before the first render.' }),
  })
  .openapi('StudioDraftCard');
export const OverviewItem = z.object({ item: PlanItemRef, draft: orNull(DraftCard).openapi({ description: 'null until drafted.' }) }).openapi('StudioOverviewItem');
export const OverviewQuery = z.object({
  weekStart: day.optional().openapi({ description: 'The first day of a brand week. Default: the current week. Another day answers 400.' }),
});
export const Overview = z
  .object({
    weekStart: day,
    planApproved: z.boolean().openapi({ description: 'False when the week has no approved plan: items is then empty and the screen links to the Plan calendar.' }),
    items: z.array(OverviewItem).openapi({ description: 'The approved plan items, by day then position.' }),
    ready: z.object({ facts: z.boolean().openapi({ description: 'The brand has an approved fact. Drafting needs it.' }) }).openapi('StudioReady'),
    latestRun: orNull(StudioRun).openapi({ description: 'The newest generate run that touched one of these items, so a screen can resume RunProgress.' }),
    monthCost: StudioMoney.openapi({ description: "This month's (UTC) AI spend on Studio." }),
  })
  .openapi('StudioOverview');

// ---------- drafts
export const DraftCreate = z
  .object({ planItemIds: z.array(z.string()).min(1).max(50) })
  .openapi('StudioDraftCreate', { description: 'Items of this brand whose week is approved and that have no draft yet. Another brand, an unapproved week or an item that already has a draft is refused (404, 409).' });
export const DraftView = z
  .object({
    draft: z.object({
      id: z.string(), planItemId: z.string(), kind: Kind, status: DraftStatus, currentVersion: z.number().int(),
      readyVersion: z.number().int().nullable(), readyAt: iso.nullable(), createdAt: iso,
    }),
    version: z.object({ version: z.number().int(), origin: z.enum(['model', 'owner']), createdAt: iso }),
    versions: z.array(z.object({ version: z.number().int(), origin: z.enum(['model', 'owner']), createdAt: iso })).openapi({ description: 'Newest first.' }),
    planItem: orNull(PlanItemRef).openapi({ description: 'null when the plan item was deleted; the draft stays readable.' }),
    planApproved: z.boolean().openapi({ description: 'False when the item was deleted or its week went back to draft: the draft is stale, readable, and cannot be regenerated.' }),
    weekStart: orNull(day).openapi({ description: "The first day of the plan item's week, so a screen can link back to it; null when the item was deleted." }),
    channel: z.string(), languages: z.array(z.string()).openapi({ description: 'The brand languages.' }),
    missingLanguages: z.array(z.string()).openapi({ description: 'Brand languages with no copy in this version.' }),
    content: Content,
    leftOut: z.array(LeftOut).openapi({ description: 'Claims removed for lack of an approved fact.' }),
    facts: z.array(FactRef), findings: z.array(Finding).openapi({ description: 'Blocking first. Computed on every read against today\'s facts and rights.' }),
    blockingCount: z.number().int(), renders: z.array(Render).openapi({ description: 'Of the current version only.' }),
    canMarkReady: z.boolean(), cannotMarkReadyReason: z.string().nullable(),
    latestRun: orNull(StudioRun).openapi({ description: 'The newest run of this draft (its generate run or a render run).' }),
  })
  .openapi('StudioDraftView');

export const TemplateList = z
  .object({
    templates: z.array(z.object({ name: Template, label: z.string(), description: z.string() })),
    ratios: z.array(z.object({ ratio: Ratio, width: z.number().int(), height: z.number().int(), label: z.string() })),
  })
  .openapi('StudioTemplateList');
