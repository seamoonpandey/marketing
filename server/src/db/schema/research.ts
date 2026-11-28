import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, boolean } from 'drizzle-orm/pg-core';
import type { Place, SearchHit, SearchKind } from '../../search/index.ts';
import { brandColumns, brandPolicies, runColumns } from './core.ts';

const id = () => uuid('id').primaryKey().default(sql`uuidv7()`);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

// competitor_id is a plain column, not a foreign key: deleting a competitor stops its targets
// (the run skips them) and leaves its observations readable.
export const watchTargets = pgTable(
  'watch_targets',
  {
    id: id(),
    ...brandColumns,
    competitorId: uuid('competitor_id').notNull(),
    url: text('url').notNull(),
    label: text('label'),
    status: text('status', { enum: ['active', 'paused', 'unreachable', 'blocked'] }).notNull().default('active'),
    failCount: integer('fail_count').notNull().default(0),
    lastError: text('last_error'),
    lastSourceId: uuid('last_source_id'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('watch_targets_brand_url').on(t.brandId, t.url), ...brandPolicies('watch_targets')],
);

export const watchSchedules = pgTable(
  'watch_schedules',
  {
    id: id(),
    ...brandColumns,
    enabled: boolean('enabled').notNull().default(false),
    weekday: integer('weekday').notNull().default(1),
    hour: integer('hour').notNull().default(6),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('watch_schedules_brand').on(t.brandId), ...brandPolicies('watch_schedules')],
);

export type RunCounts = {
  pages: number; changed: number; unchanged: number; failed: number;
  observations: number; discarded: number; opportunities: number;
};

export const watchRuns = pgTable(
  'watch_runs',
  {
    id: id(),
    ...brandColumns,
    trigger: text('trigger', { enum: ['baseline', 'weekly', 'manual'] }).notNull(),
    counts: jsonb('counts').$type<Partial<RunCounts>>().notNull().default({}),
    workflowId: text('workflow_id'),
    ...runColumns,
    createdAt: createdAt(),
  },
  (t) => [
    // One active run per brand, enforced by the database as well as by startRun.
    uniqueIndex('watch_runs_one_active').on(t.brandId).where(sql`state in ('running', 'awaiting_approval')`),
    ...brandPolicies('watch_runs'),
  ],
);

export type ProfileEntry = {
  kind: 'positioning' | 'product' | 'offer' | 'cta';
  text: string;
  price: string | null;
  quote: string;
  url: string;
  sourceId: string;
};

export const competitorProfiles = pgTable(
  'competitor_profiles',
  {
    id: id(),
    ...brandColumns,
    competitorId: uuid('competitor_id').notNull(),
    profile: jsonb('profile').$type<{ entries: ProfileEntry[] }>().notNull(),
    sourceIds: uuid('source_ids').array().notNull().default(sql`'{}'::uuid[]`),
    runId: uuid('run_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('competitor_profiles_competitor').on(t.competitorId, t.createdAt), ...brandPolicies('competitor_profiles')],
);

export const observationTypes = [
  'price_change', 'new_offer', 'offer_ended', 'new_product', 'product_removed', 'messaging_change', 'other',
] as const;
export type Evidence = { quote: string; sourceId: string };

export const observations = pgTable(
  'observations',
  {
    id: id(),
    ...brandColumns,
    competitorId: uuid('competitor_id').notNull(),
    runId: uuid('run_id').notNull(),
    type: text('type', { enum: observationTypes }).notNull(),
    summary: text('summary').notNull(),
    before: jsonb('before').$type<Evidence | null>(),
    after: jsonb('after').$type<Evidence>().notNull(),
    url: text('url').notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow(),
    confidence: text('confidence', { enum: ['low', 'medium', 'high'] }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('observations_brand_time').on(t.brandId, t.observedAt), ...brandPolicies('observations')],
);

export type OpportunityEvidence = { type: 'observation' | 'profile' | 'candidate' | 'fact'; id: string; label: string; detail: string; quote?: string; sourceId?: string };

export const opportunities = pgTable(
  'opportunities',
  {
    id: id(),
    ...brandColumns,
    runId: uuid('run_id'),
    title: text('title').notNull(),
    hypothesis: text('hypothesis').notNull(),
    suggestedAction: text('suggested_action').notNull(),
    whyItMatters: text('why_it_matters').notNull(),
    observationIds: uuid('observation_ids').array().notNull(),
    confidence: text('confidence', { enum: ['low', 'medium', 'high'] }).notNull(),
    kind: text('kind', { enum: ['change', 'gap', 'strength'] }).notNull().default('change'),
    impact: text('impact', { enum: ['low', 'medium', 'high'] }).notNull().default('medium'),
    effort: text('effort', { enum: ['low', 'medium', 'high'] }).notNull().default('medium'),
    // A snapshot of what it cites, readable after its competitor is deleted. Empty on rows from before evidence.
    evidence: jsonb('evidence').$type<OpportunityEvidence[]>().notNull().default([]),
    status: text('status', { enum: ['new', 'accepted', 'dismissed'] }).notNull().default('new'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  () => brandPolicies('opportunities'),
);

export const battlecards = pgTable(
  'battlecards',
  {
    id: id(),
    ...brandColumns,
    competitorId: uuid('competitor_id').notNull(),
    version: integer('version').notNull(),
    status: text('status', { enum: ['draft', 'approved', 'replaced'] }).notNull().default('draft'),
    body: jsonb('body').notNull(),
    leftOut: jsonb('left_out').notNull(),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('battlecards_version').on(t.competitorId, t.version), ...brandPolicies('battlecards')],
);

export const discoveryColumns = ['kind', 'sells', 'sellsTo', 'priceLevel', 'where', 'pitch', 'overlap'] as const;
export type DiscoveryColumn = (typeof discoveryColumns)[number];
export type Cell =
  | { value: string; basis: 'quoted'; quote: string; sourceId: string }
  | { value: string; basis: 'inferred'; reason: string; evidence: string[]; confidence: 'low' | 'medium' | 'high' };
export type Cells = Partial<Record<DiscoveryColumn, Cell>>;
export const ownColumns = ['sells', 'sellsTo', 'priceLevel', 'where', 'pitch'] as const;
export type OwnCell = { value: string; factIds: string[] };
export type OwnRow = Partial<Record<(typeof ownColumns)[number], OwnCell>>;
/** A search hit as a run stores it; IDs r1, r2, … in query order. */
export type SearchResult = SearchHit & { id: string; kind: SearchKind; query: string };
export type DiscoveryCounts = { queries: number; failedQueries: number; results: number; found: number; skipped: number; profiled: number; failedProfiles: number; dropped: number };

export const discoveryRuns = pgTable(
  'discovery_runs',
  {
    id: id(),
    ...brandColumns,
    keywords: text('keywords').array().notNull(),
    results: jsonb('results').$type<SearchResult[]>().notNull().default([]),
    ownRow: jsonb('own_row').$type<OwnRow | null>(),
    counts: jsonb('counts').$type<Partial<DiscoveryCounts>>().notNull().default({}),
    workflowId: text('workflow_id'),
    ...runColumns,
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('discovery_runs_one_active').on(t.brandId).where(sql`state in ('running', 'awaiting_approval')`),
    ...brandPolicies('discovery_runs'),
  ],
);

// competitor_id and the run IDs are plain columns, as in watch_targets: deleting either leaves the candidate readable.
export const discoveryCandidates = pgTable(
  'discovery_candidates',
  {
    id: id(),
    ...brandColumns,
    matchKey: text('match_key').notNull(),
    name: text('name').notNull(),
    site: text('site'),
    channels: jsonb('channels').$type<string[]>().notNull().default([]),
    placeCid: text('place_cid'),
    place: jsonb('place').$type<Place | null>(), // from the business's first Maps hit, for the rating
    cells: jsonb('cells').$type<Cells>().notNull().default({}),
    sourceIds: uuid('source_ids').array().notNull().default(sql`'{}'::uuid[]`),
    rank: integer('rank').notNull(),
    status: text('status', { enum: ['new', 'watched', 'dismissed'] }).notNull().default('new'),
    competitorId: uuid('competitor_id'),
    firstRunId: uuid('first_run_id').notNull(),
    lastRunId: uuid('last_run_id').notNull(),
    lastFoundAt: timestamp('last_found_at', { withTimezone: true }).notNull().defaultNow(),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('discovery_candidates_key').on(t.brandId, t.matchKey), ...brandPolicies('discovery_candidates')],
);
