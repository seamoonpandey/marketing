// Owned by the research branch (docs/structure.md).
import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, boolean } from 'drizzle-orm/pg-core';
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
