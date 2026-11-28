// Request and response schemas of /api/brands/{brandId}/research/…
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

const Level = z.enum(['low', 'medium', 'high']).openapi('ResearchLevel');

export const OpportunityEvidence = z
  .object({
    type: z.enum(['observation', 'profile', 'candidate', 'fact']),
    id: z.string().openapi({ description: 'The observation, profile, candidate or fact row it was taken from.' }),
    label: z.string().openapi({ description: 'Who: the competitor name, or "Your brand".' }),
    detail: z.string().openapi({ description: 'What.' }),
    quote: z.string().optional(), sourceId: z.string().optional(),
  })
  .openapi('OpportunityEvidence', { description: 'A snapshot taken when the opportunity was made; it stays readable after its competitor is deleted.' });

export const Opportunity = z
  .object({
    id: z.string(), runId: z.string().nullable(), kind: z.enum(['change', 'gap', 'strength']), title: z.string(), hypothesis: z.string(),
    suggestedAction: z.string(), whyItMatters: z.string(),
    observationIds: z.array(z.string()).openapi({ description: 'The observations among its evidence; may be empty.' }),
    evidence: z.array(OpportunityEvidence), confidence: Confidence, impact: Level, effort: Level,
    status: z.enum(['new', 'accepted', 'dismissed']), decidedAt: iso.nullable(), createdAt: iso,
  })
  .openapi('Opportunity');
export const OpportunitiesQuery = z.object({ status: z.enum(['new', 'accepted', 'dismissed']).optional() });
export const OpportunityScanResult = z
  .object({ created: z.array(Opportunity), dropped: z.number().int().openapi({ description: 'Proposals the server did not keep.' }) })
  .openapi('OpportunityScanResult');

export const DiscoveryCell = z
  .discriminatedUnion('basis', [
    z.object({ value: z.string(), basis: z.literal('quoted'), quote: z.string(), sourceId: z.string() }),
    z.object({ value: z.string(), basis: z.literal('inferred'), reason: z.string(), evidence: z.array(z.string()), confidence: Confidence }),
  ])
  .openapi('DiscoveryCell', { description: 'quoted: the quote is in the saved source. inferred: a reasoned guess from the evidence.' });
const cell = DiscoveryCell.optional();
export const DiscoveryCells = z
  .object({ kind: cell, sells: cell, sellsTo: cell, priceLevel: cell, where: cell, pitch: cell, overlap: cell })
  .openapi('DiscoveryCells');
const ownCell = z.object({ value: z.string(), factIds: z.array(z.string()) }).optional();
export const DiscoveryOwnRow = z
  .object({ sells: ownCell, sellsTo: ownCell, priceLevel: ownCell, where: ownCell, pitch: ownCell })
  .openapi('DiscoveryOwnRow', { description: "The brand's own row, from its approved facts." });
export const DiscoveryPlace = z
  .object({
    address: z.string().nullable(), category: z.string().nullable(), rating: z.number().nullable(), ratingCount: z.number().nullable(),
    phone: z.string().nullable(), cid: z.string().nullable(),
  })
  .openapi('DiscoveryPlace');

const count = z.number().int().optional();
export const DiscoveryCounts = z
  .object({
    queries: count, failedQueries: count, results: count, found: count, skipped: count, profiled: count, failedProfiles: count, dropped: count,
  })
  .openapi('DiscoveryCounts');
export const DiscoveryRun = z
  .object({
    id: z.string(), keywords: z.array(z.string()), state: RunState, error: z.string().nullable(),
    startedAt: iso.nullable(), finishedAt: iso.nullable(), estimate: orNull(RunMoney), actual: orNull(RunMoney),
    counts: DiscoveryCounts, ownRow: orNull(DiscoveryOwnRow), createdAt: iso,
  })
  .openapi('DiscoveryRun');
export const DiscoveryRunCreate = z
  .object({ keywords: z.array(z.string().max(500)).min(1).max(50) })
  .openapi('DiscoveryRunCreate', { description: 'At most 15 keywords of at most 80 characters, after cleaning.' });
export const KeywordSuggestions = z.object({ keywords: z.array(z.string()) }).openapi('KeywordSuggestions');

const CandidateStatus = z.enum(['new', 'watched', 'dismissed']);
export const DiscoveryCandidate = z
  .object({
    id: z.string(), name: z.string(), site: z.string().nullable(), channels: z.array(z.string()), place: orNull(DiscoveryPlace),
    cells: DiscoveryCells, sourceIds: z.array(z.string()), rank: z.number().int(), status: CandidateStatus,
    competitorId: z.string().nullable(), lastFoundAt: iso, dismissedAt: iso.nullable(),
  })
  .openapi('DiscoveryCandidate');
export const CandidateWatch = z.object({ ids: z.array(z.string()).min(1).max(30) }).openapi('CandidateWatch');
export const CandidateWatchResult = z
  .object({
    watched: z.array(DiscoveryCandidate),
    unreadable: z.array(z.string()).openapi({ description: 'IDs of candidates whose site gave no pages.' }),
  })
  .openapi('CandidateWatchResult');
export const CandidatesQuery = z.object({ status: CandidateStatus.optional().openapi({ description: 'Without it: new and watched.' }) });

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
