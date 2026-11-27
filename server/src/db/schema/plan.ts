import { sql } from 'drizzle-orm';
import { date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { campaignStatuses, channels, formats, funnels, intents, objectives, pillars } from '../../domain/plan/enums.ts';
import { brandColumns, brandPolicies, runColumns } from './core.ts';

const id = () => uuid('id').primaryKey().default(sql`uuidv7()`);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export type ChannelSetting = { channel: (typeof channels)[number]; postsPerWeek: number };
export type PillarSetting = { pillar: (typeof pillars)[number]; weight: number };

export const planSettings = pgTable(
  'plan_settings',
  {
    id: id(),
    ...brandColumns,
    channels: jsonb('channels').$type<ChannelSetting[]>().notNull().default([]),
    pillars: jsonb('pillars').$type<PillarSetting[]>().notNull().default([]),
    weekStarts: integer('week_starts').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('plan_settings_brand').on(t.brandId), ...brandPolicies('plan_settings')],
);

export const campaigns = pgTable(
  'campaigns',
  {
    id: id(),
    ...brandColumns,
    name: text('name').notNull(),
    objective: text('objective', { enum: objectives }).notNull(),
    status: text('status', { enum: campaignStatuses }).notNull().default('draft'),
    startsOn: date('starts_on', { mode: 'string' }),
    endsOn: date('ends_on', { mode: 'string' }),
    segmentId: uuid('segment_id'),
    opportunityId: uuid('opportunity_id'),
    budgetNpr: numeric('budget_npr', { precision: 12, scale: 2 }),
    createdAt: createdAt(),
  },
  (t) => [index('campaigns_brand').on(t.brandId, t.createdAt), ...brandPolicies('campaigns')],
);

export const campaignBriefs = pgTable(
  'campaign_briefs',
  {
    id: id(),
    ...brandColumns,
    campaignId: uuid('campaign_id').notNull(),
    version: integer('version').notNull(),
    status: text('status', { enum: ['draft', 'approved', 'replaced'] }).notNull().default('draft'),
    body: jsonb('body').notNull(),
    leftOut: jsonb('left_out').notNull().default([]),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('campaign_briefs_version').on(t.campaignId, t.version), ...brandPolicies('campaign_briefs')],
);

export const weekPlans = pgTable(
  'week_plans',
  {
    id: id(),
    ...brandColumns,
    weekStart: date('week_start', { mode: 'string' }).notNull(),
    version: integer('version').notNull(),
    status: text('status', { enum: ['draft', 'approved', 'replaced'] }).notNull().default('draft'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    runId: uuid('run_id'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('week_plans_version').on(t.brandId, t.weekStart, t.version), ...brandPolicies('week_plans')],
);

export const planItems = pgTable(
  'plan_items',
  {
    id: id(),
    ...brandColumns,
    weekPlanId: uuid('week_plan_id').notNull(),
    day: date('day', { mode: 'string' }).notNull(),
    channel: text('channel', { enum: channels }).notNull(),
    format: text('format', { enum: formats }),
    pillar: text('pillar', { enum: pillars }),
    funnel: text('funnel', { enum: funnels }),
    intent: text('intent', { enum: intents }),
    segmentId: uuid('segment_id'),
    campaignId: uuid('campaign_id'),
    idea: text('idea').notNull().default(''),
    cta: text('cta').notNull().default(''),
    factIds: uuid('fact_ids').array().notNull().default(sql`'{}'::uuid[]`),
    position: integer('position').notNull().default(0),
    origin: text('origin', { enum: ['model', 'owner'] }).notNull().default('owner'),
    createdAt: createdAt(),
  },
  (t) => [index('plan_items_week').on(t.weekPlanId), ...brandPolicies('plan_items')],
);

export type PlanCounts = { items?: number; dropped?: number; campaigns?: number };

export const planRuns = pgTable(
  'plan_runs',
  {
    id: id(),
    ...brandColumns,
    kind: text('kind', { enum: ['week', 'brief'] }).notNull(),
    targetId: text('target_id').notNull(),
    workflowId: text('workflow_id'),
    counts: jsonb('counts').$type<PlanCounts>().notNull().default({}),
    ...runColumns,
    createdAt: createdAt(),
  },
  (t) => [
    // One active run per target (a week or a campaign), enforced by the database as well as by the start.
    uniqueIndex('plan_runs_one_active').on(t.brandId, t.kind, t.targetId).where(sql`state in ('running', 'awaiting_approval')`),
    ...brandPolicies('plan_runs'),
  ],
);
