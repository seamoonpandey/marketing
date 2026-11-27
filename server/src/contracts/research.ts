// Owned by the research branch (docs/structure.md). Request and response schemas of
// /api/brands/{brandId}/research/…
import { z } from '@hono/zod-openapi';
import { namedMoney, orNull } from './common.ts';

const iso = z.string().openapi({ example: '2026-11-27T06:00:00.000Z', description: 'ISO 8601 timestamp' });
const Confidence = z.enum(['low', 'medium', 'high']).openapi('ResearchConfidence');

export const TargetStatus = z.enum(['active', 'paused', 'unreachable', 'blocked']).openapi('WatchTargetStatus');

export const WatchTarget = z
  .object({
    id: z.string(), competitorId: z.string(), url: z.string(), label: z.string().nullable(),
    status: TargetStatus,
    failCount: z.number().int().openapi({ description: 'Failed runs in a row; the third pauses the page.' }),
    lastError: z.string().nullable(), lastSourceId: z.string().nullable(), createdAt: iso,
  })
  .openapi('WatchTarget');

export const TargetCreate = z
  .object({ competitorId: z.string(), url: z.string().trim().min(1).max(2000), label: z.string().trim().max(200).optional() })
  .openapi('WatchTargetCreate');
export const TargetPatch = z.object({ status: z.enum(['active', 'paused']) }).openapi('WatchTargetPatch');
export const TargetsQuery = z.object({ competitorId: z.string().optional() });
export const SuggestRequest = z.object({ competitorId: z.string() }).openapi('WatchTargetSuggestRequest');
export const SuggestResponse = z
  .object({ urls: z.array(z.string()) })
  .openapi('WatchTargetSuggestions', { description: 'Pages of the competitor site worth watching, at most 5.' });

export const RunTrigger = z.enum(['baseline', 'weekly', 'manual']).openapi('WatchRunTrigger');
const RunMoney = namedMoney('RunMoney');
export const RunState = z
  .enum(['running', 'awaiting_approval', 'completed', 'failed_retryable', 'failed_final', 'cancelled'])
  .openapi('WatchRunState');
export const RunCounts = z
  .object({
    pages: z.number().int().optional(), changed: z.number().int().optional(), unchanged: z.number().int().optional(),
    failed: z.number().int().optional(),
    observations: z.number().int().optional(),
    discarded: z.number().int().optional().openapi({ description: 'Model answers dropped because a quote was not in the saved page.' }),
    opportunities: z.number().int().optional(),
  })
  .openapi('WatchRunCounts');

export const WatchRun = z
  .object({
    id: z.string(), trigger: RunTrigger, state: RunState, error: z.string().nullable(),
    startedAt: iso.nullable(), finishedAt: iso.nullable(),
    estimate: orNull(RunMoney), // set once the changed pages are known
    actual: orNull(RunMoney), counts: RunCounts, createdAt: iso,
  })
  .openapi('WatchRun');
export const RunCreate = z
  .object({ trigger: z.enum(['baseline', 'manual']).default('manual') })
  .openapi('WatchRunCreate', { description: 'The first run of a brand should be a baseline; weekly runs start from the schedule.' });

export const Schedule = z
  .object({
    enabled: z.boolean(), weekday: z.number().int().min(0).max(6).openapi({ description: '0 Sunday … 6 Saturday, in the brand timezone' }),
    hour: z.number().int().min(0).max(23), lastRunAt: iso.nullable(),
  })
  .openapi('WatchSchedule');
export const ScheduleUpdate = Schedule.pick({ enabled: true, weekday: true, hour: true }).openapi('WatchScheduleUpdate');

export const Evidence = z
  .object({ quote: z.string(), sourceId: z.string().openapi({ description: 'A base source row: GET /brands/{brandId}/sources/{id}' }) })
  .openapi('ResearchEvidence');
export const ObservationType = z
  .enum(['price_change', 'new_offer', 'offer_ended', 'new_product', 'product_removed', 'messaging_change', 'other'])
  .openapi('ObservationType');
export const Observation = z
  .object({
    id: z.string(), competitorId: z.string(),
    competitorName: z.string().nullable().openapi({ description: 'null when the competitor was deleted; the observation stays.' }),
    runId: z.string(), type: ObservationType, summary: z.string(),
    before: orNull(Evidence), after: Evidence, url: z.string(), observedAt: iso, confidence: Confidence,
  })
  .openapi('Observation');
export const ObservationsQuery = z.object({
  competitorId: z.string().optional(), type: ObservationType.optional(),
  since: z.string().optional().openapi({ description: 'ISO timestamp; only observations at or after it' }),
  runId: z.string().optional(),
});

export const ProfileEntry = z
  .object({
    kind: z.enum(['positioning', 'product', 'offer', 'cta']), text: z.string(), price: z.string().nullable(),
    quote: z.string(), url: z.string(), sourceId: z.string(),
  })
  .openapi('ProfileEntry');
export const Profile = z
  .object({ competitorId: z.string(), runId: z.string(), createdAt: iso, entries: z.array(ProfileEntry), sourceIds: z.array(z.string()) })
  .openapi('CompetitorProfile');

export const Opportunity = z
  .object({
    id: z.string(), runId: z.string().nullable(), title: z.string(), hypothesis: z.string(), suggestedAction: z.string(),
    whyItMatters: z.string(), observationIds: z.array(z.string()).openapi({ description: 'Observations that back it; never empty.' }),
    confidence: Confidence, status: z.enum(['new', 'accepted', 'dismissed']), decidedAt: iso.nullable(), createdAt: iso,
  })
  .openapi('Opportunity');
export const OpportunitiesQuery = z.object({ status: z.enum(['new', 'accepted', 'dismissed']).optional() });

export const Statement = z
  .object({
    text: z.string(), factIds: z.array(z.string()).optional(), observationIds: z.array(z.string()).optional(),
    profileQuote: z.string().optional(),
  })
  .openapi('BattlecardStatement');
export const BattlecardBody = z
  .object({ differ: z.array(Statement), proof: z.array(Statement), objections: z.array(Statement), responses: z.array(Statement) })
  .openapi('BattlecardBody');
export const Battlecard = z
  .object({
    id: z.string(), competitorId: z.string(), version: z.number().int(), status: z.enum(['draft', 'approved', 'replaced']),
    body: BattlecardBody,
    leftOut: z.array(z.object({ text: z.string(), reason: z.string() })).openapi({ description: 'Removed statements; reason is "no approved fact" or "no evidence".' }),
    approvedAt: iso.nullable(), createdAt: iso,
  })
  .openapi('Battlecard');
export const BattlecardPair = z
  .object({ approved: orNull(Battlecard), draft: orNull(Battlecard) })
  .openapi('BattlecardPair');
