// Owned by the plan branch (docs/structure.md). Request and response schemas of
// /api/brands/{brandId}/plan/…
import { z } from '@hono/zod-openapi';
import { briefSections, campaignStatuses, channels, formats, funnels, intents, objectives, pillars } from '../domain/plan/enums.ts';

const iso = z.string().openapi({ example: '2026-11-27T06:00:00.000Z', description: 'ISO 8601 timestamp' });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).openapi({ example: '2026-11-29', description: 'A calendar date, YYYY-MM-DD' });
// Money, restated here: the base Money schema carries a description that openapi-typescript turns into `Money & unknown`.
const PlanMoney = z.object({ usd: z.string(), npr: z.string() }).openapi('PlanMoney', { description: 'Decimal strings: usd to 4 places, npr to 2.' });

export const Objective = z.enum(objectives).openapi('PlanObjective');
export const Funnel = z.enum(funnels).openapi('PlanFunnel');
export const Pillar = z.enum(pillars).openapi('PlanPillar');
export const Format = z.enum(formats).openapi('PlanFormat');
export const Intent = z.enum(intents).openapi('PlanIntent');
export const Channel = z.enum(channels).openapi('PlanChannel');

export const Settings = z
  .object({
    channels: z.array(z.object({ channel: Channel, postsPerWeek: z.number().int().min(1).max(14) })).openapi({ description: 'A channel at most once.' }),
    pillars: z.array(z.object({ pillar: Pillar, weight: z.number().min(0) })),
    weekStarts: z.number().int().min(0).max(6).openapi({ description: '0 Sunday … 6 Saturday. Every week start date must fall on this weekday.' }),
  })
  .openapi('PlanSettings');

// Readiness, so a screen can show the empty state that links to the screen that fixes it.
export const Ready = z
  .object({
    facts: z.boolean().openapi({ description: 'The brand has at least one approved fact. Drafting needs it.' }),
    channels: z.boolean().openapi({ description: 'The settings list at least one channel. Drafting needs it.' }),
  })
  .openapi('PlanReady');

export const FactRef = z
  .object({ id: z.string(), section: z.string(), subjectName: z.string().nullable(), field: z.string(), value: z.unknown(), unit: z.string().nullable() })
  .openapi('PlanFactRef', { description: 'An approved fact that something cites. A cited id missing from the list is not approved today.' });

// ---------- runs
export const RunState = z.enum(['running', 'awaiting_approval', 'completed', 'failed_retryable', 'failed_final', 'cancelled']).openapi('PlanRunState');
export const PlanRun = z
  .object({
    id: z.string(), kind: z.enum(['week', 'brief']), targetId: z.string().openapi({ description: 'The week start date or the campaign id.' }),
    state: RunState, error: z.string().nullable(), startedAt: iso.nullable(), finishedAt: iso.nullable(),
    estimate: z.union([PlanMoney, z.null()]), actual: z.union([PlanMoney, z.null()]),
    counts: z
      .object({
        items: z.number().int().optional().openapi({ description: 'Items stored.' }),
        dropped: z.number().int().optional().openapi({ description: 'Model items dropped: day outside the week, channel not in settings, or over the posts per week.' }),
      })
      .openapi('PlanRunCounts'),
    createdAt: iso,
  })
  .openapi('PlanRun');
export const Estimate = z
  .object({ estimate: PlanMoney, remaining: PlanMoney.openapi({ description: 'What the tenant may still spend this month.' }) })
  .openapi('PlanEstimate', { description: 'The most the draft can cost. Show it before starting.' });

// ---------- campaigns
export const CampaignStatus = z.enum(campaignStatuses).openapi('PlanCampaignStatus');
export const Campaign = z
  .object({
    id: z.string(), name: z.string(), objective: Objective, status: CampaignStatus,
    startsOn: day.nullable(), endsOn: day.nullable(), segmentId: z.string().nullable(), opportunityId: z.string().nullable(),
    budgetNpr: z.string().nullable().openapi({ description: 'Decimal string.' }), createdAt: iso,
  })
  .openapi('PlanCampaign');
export const CampaignCreate = z
  .object({
    name: z.string().trim().min(1).max(200), objective: Objective, startsOn: day.optional(), endsOn: day.optional(),
    segmentId: z.string().optional(),
    opportunityId: z.string().optional().openapi({ description: 'An accepted opportunity of this brand; a dismissed or foreign one is refused with 400 or 404.' }),
    budgetNpr: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  })
  .openapi('PlanCampaignCreate');
export const CampaignPatch = z
  .object({
    name: z.string().trim().min(1).max(200), objective: Objective, status: CampaignStatus,
    startsOn: day.nullable(), endsOn: day.nullable(), segmentId: z.string().nullable(), budgetNpr: z.string().regex(/^\d+(\.\d{1,2})?$/).nullable(),
  })
  .partial()
  .openapi('PlanCampaignPatch');
export const CampaignsQuery = z.object({ status: CampaignStatus.optional() });

export const Statement = z.object({ text: z.string().trim().min(1).max(2000), factIds: z.array(z.string()).optional() }).openapi('PlanStatement');
export const BriefSection = z.enum(briefSections).openapi('PlanBriefSection');
export const BriefBody = z.object(Object.fromEntries(briefSections.map((s) => [s, z.array(Statement)])) as Record<(typeof briefSections)[number], z.ZodArray<typeof Statement>>).openapi('PlanBriefBody');
export const Brief = z
  .object({
    id: z.string(), campaignId: z.string(), version: z.number().int(), status: z.enum(['draft', 'approved', 'replaced']), body: BriefBody,
    leftOut: z
      .array(z.object({ section: z.string(), text: z.string(), reason: z.string() }))
      .openapi({ description: 'Removed statements. reason is "no approved fact" (audience and offer_message statements need one).' }),
    approvedAt: iso.nullable(), createdAt: iso,
  })
  .openapi('PlanBrief');
export const BriefView = z
  .object({
    campaign: Campaign,
    approved: z.union([Brief, z.null()]), draft: z.union([Brief, z.null()]),
    facts: z.array(FactRef).openapi({ description: 'The currently approved facts that the two versions cite.' }),
    latestRun: z.union([PlanRun, z.null()]).openapi({ description: 'The newest brief run of this campaign, so a screen can resume RunProgress.' }),
    ready: Ready,
  })
  .openapi('PlanBriefView', { description: 'Editing an approved brief retires it and leaves a new draft: approved becomes null.' });
export const BriefEdit = z.object({ body: BriefBody }).openapi('PlanBriefEdit');

// ---------- weeks
export const WeekStatus = z.enum(['draft', 'approved', 'replaced']).openapi('PlanWeekStatus');
export const WeekPlan = z
  .object({ id: z.string(), weekStart: day, version: z.number().int(), status: WeekStatus, approvedAt: iso.nullable(), runId: z.string().nullable(), createdAt: iso })
  .openapi('PlanWeekPlan');
export const PlanItem = z
  .object({
    id: z.string(), weekPlanId: z.string(), day, channel: Channel,
    format: Format.nullable(), pillar: Pillar.nullable(), funnel: Funnel.nullable(), intent: Intent.nullable(),
    segmentId: z.string().nullable(), campaignId: z.string().nullable(),
    idea: z.string(), cta: z.string(), factIds: z.array(z.string()), position: z.number().int(), origin: z.enum(['model', 'owner']),
  })
  .openapi('PlanItem');
export const ItemCreate = z
  .object({
    day, channel: Channel, format: Format.optional(), pillar: Pillar.optional(), funnel: Funnel.optional(), intent: Intent.optional(),
    segmentId: z.string().optional(), campaignId: z.string().optional(),
    idea: z.string().max(2000).optional(), cta: z.string().max(500).optional(), factIds: z.array(z.string()).optional(),
  })
  .openapi('PlanItemCreate', { description: 'day must fall inside the week. An incomplete item is allowed; it blocks approval until completed.' });
export const ItemPatch = z
  .object({
    day, channel: Channel, format: Format.nullable(), pillar: Pillar.nullable(), funnel: Funnel.nullable(), intent: Intent.nullable(),
    segmentId: z.string().nullable(), campaignId: z.string().nullable(),
    idea: z.string().max(2000), cta: z.string().max(500), factIds: z.array(z.string()),
  })
  .partial()
  .openapi('PlanItemPatch');
export const Rule = z
  .enum(['same_day_channel', 'incomplete', 'duplicate_idea', 'unknown_fact', 'channel_count', 'pillar_share', 'format_variety', 'repeat_idea'])
  .openapi('PlanRule');
export const Violation = z
  .object({ rule: Rule, blocking: z.boolean(), itemIds: z.array(z.string()), message: z.string() })
  .openapi('PlanViolation');
export const WeekView = z
  .object({
    weekStart: day, plan: z.union([WeekPlan, z.null()]).openapi({ description: 'The newest draft if there is one, else the approved plan; null when the week has no plan yet.' }),
    items: z.array(PlanItem).openapi({ description: 'Ordered by day, then position.' }),
    violations: z.array(Violation).openapi({ description: 'Blocking ones first.' }),
    blockingCount: z.number().int(),
    canApprove: z.boolean(), cannotApproveReason: z.string().nullable().openapi({ description: 'Why approval is disabled, or null.' }),
    approvedPlan: z.union([WeekPlan, z.null()]).openapi({ description: 'The approval that still stands while a newer draft is shown in plan; null when plan is itself the approved one or nothing is approved.' }),
    facts: z.array(FactRef).openapi({ description: 'The currently approved facts that the items cite.' }),
    latestRun: z.union([PlanRun, z.null()]).openapi({ description: 'The newest run for this week, so a screen can resume RunProgress.' }),
    ready: Ready,
  })
  .openapi('PlanWeekView');
export const WeekParams = z.object({
  weekStart: day.openapi({ param: { name: 'weekStart', in: 'path' }, description: 'Must be the first day of the brand week (settings.weekStarts), else 400.' }),
});
export const ItemResult = z.object({ item: PlanItem, plan: WeekPlan }).openapi('PlanItemResult', { description: 'plan.status shows whether the edit set an approved week back to draft.' });
export const ItemRemoved = z.object({ plan: WeekPlan }).openapi('PlanItemRemoved');

// ---------- overview
export const WeekCard = z
  .object({ weekStart: day, status: z.enum(['none', 'draft', 'approved']), itemCount: z.number().int(), blockingCount: z.number().int(), latestRun: z.union([PlanRun, z.null()]) })
  .openapi('PlanWeekCard');
export const OpportunityCard = z
  .object({ id: z.string(), title: z.string(), suggestedAction: z.string(), whyItMatters: z.string(), confidence: z.enum(['low', 'medium', 'high']) })
  .openapi('PlanOpportunityCard');
export const Overview = z
  .object({
    ready: Ready,
    weeks: z.array(WeekCard).openapi({ description: 'Always two: this week, then next week.' }),
    activeCampaigns: z.array(Campaign),
    opportunities: z.array(OpportunityCard).openapi({ description: 'Accepted opportunities that no campaign started from.' }),
    monthCost: PlanMoney.openapi({ description: "This month's (UTC) AI spend on planning." }),
  })
  .openapi('PlanOverview');
