import { sql, type SQL } from 'drizzle-orm';
import {
  bigint, boolean, index, integer, jsonb, numeric, pgEnum, pgPolicy, pgTable, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';
import type { Money } from '../../contracts/common.ts';

const APP_ROLE = 'marketing_app';

const id = () => uuid('id').primaryKey().default(sql`uuidv7()`);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

/** The tenant and brands of the current transaction, set by withTenant and withBrand. */
const currentTenant = sql`nullif(current_setting('app.tenant_id', true), '')::uuid`;
const currentBrands = sql`coalesce(nullif(current_setting('app.brand_ids', true), ''), '{}')::uuid[]`;

const tenantId = () => uuid('tenant_id').notNull().default(currentTenant).references(() => tenants.id);

const isolation = (name: string, check: SQL) =>
  pgPolicy(name, { as: 'permissive', for: 'all', to: APP_ROLE, using: check, withCheck: check });

export const runStates = ['running', 'awaiting_approval', 'completed', 'failed_retryable', 'failed_final', 'cancelled'] as const;
export const runState = pgEnum('run_state', runStates);

/** { tenantId, brandId } for every brand-owned table. tenant_id defaults to the transaction's tenant. */
export const brandColumns = {
  tenantId: tenantId(),
  brandId: uuid('brand_id').notNull().references(() => brands.id),
};

/** The RLS policies every brand-owned table declares: `(t) => [...brandPolicies('my_table')]`. */
export function brandPolicies(table: string) {
  return [isolation(`${table}_brand_isolation`, sql`tenant_id = ${currentTenant} and brand_id = any(${currentBrands})`)];
}

/** The columns of every run table. Money values are decimal strings in jsonb. */
export const runColumns = {
  state: runState('state').notNull().default('running'),
  error: text('error'),
  startedAt: timestamptz('started_at'),
  finishedAt: timestamptz('finished_at'),
  estimate: jsonb('estimate').$type<Money>(),
  actual: jsonb('actual').$type<Money>(),
};

// No RLS: the app resolves its tenant by slug and may only read this table (see db/setup.ts).
export const tenants = pgTable('tenants', {
  id: id(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  timezone: text('timezone').notNull().default('Asia/Kathmandu'),
  currency: text('currency').notNull().default('NPR'),
  status: text('status', { enum: ['active', 'suspended'] }).notNull().default('active'),
  createdAt: createdAt(),
});

export const brands = pgTable(
  'brands',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    website: text('website'),
    country: text('country').notNull().default('NP'),
    timezone: text('timezone').notNull().default('Asia/Kathmandu'),
    currency: text('currency').notNull().default('NPR'),
    defaultLanguage: text('default_language').notNull().default('en'),
    languages: text('languages').array().notNull().default(sql`'{en}'::text[]`),
    status: text('status', { enum: ['active', 'archived'] }).notNull().default('active'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('brands_tenant_slug').on(t.tenantId, t.slug),
    isolation('brands_tenant_isolation', sql`tenant_id = ${currentTenant}`),
  ],
);

export const competitors = pgTable(
  'competitors',
  {
    id: id(),
    ...brandColumns,
    name: text('name').notNull(),
    kind: text('kind', { enum: ['direct', 'indirect', 'aspirational'] }).notNull().default('direct'),
    site: text('site'),
    handles: jsonb('handles').$type<Record<string, string>>().notNull().default({}),
    adLibraryUrl: text('ad_library_url'),
    priority: integer('priority').notNull().default(0),
    createdAt: createdAt(),
  },
  () => brandPolicies('competitors'),
);

export const sources = pgTable(
  'sources',
  {
    id: id(),
    ...brandColumns,
    kind: text('kind', { enum: ['page', 'upload'] }).notNull(),
    uri: text('uri').notNull(),
    mime: text('mime').notNull(),
    checksum: text('checksum').notNull(),
    capturedAt: timestamptz('captured_at').notNull().defaultNow(),
    objectKey: text('object_key').notNull(),
    text: text('text'),
    trust: text('trust', { enum: ['owner', 'brand_site', 'external'] }).notNull(),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index('sources_brand').on(t.brandId), ...brandPolicies('sources')],
);

export const costEvents = pgTable(
  'cost_events',
  {
    id: id(),
    ...brandColumns,
    runType: text('run_type').notNull(),
    runId: text('run_id').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    ok: boolean('ok').notNull(),
    rateInUsd: numeric('rate_in_usd', { precision: 12, scale: 6 }).notNull(),
    rateOutUsd: numeric('rate_out_usd', { precision: 12, scale: 6 }).notNull(),
    usdNpr: numeric('usd_npr', { precision: 12, scale: 4 }).notNull(),
    costUsd: numeric('cost_usd', { precision: 12, scale: 6 }).notNull(),
    costNpr: numeric('cost_npr', { precision: 12, scale: 2 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('cost_events_tenant_time').on(t.tenantId, t.createdAt), ...brandPolicies('cost_events')],
);

// Append-only: the app role has no UPDATE or DELETE (db/setup.ts). Each row hashes its fields and
// the previous row's hash in the same chain (tenant, brand or tenant-level). seq orders the chain.
export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey(),
    seq: bigint('seq', { mode: 'number' }).generatedAlwaysAsIdentity(),
    tenantId: tenantId(),
    brandId: uuid('brand_id'),
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    objectType: text('object_type').notNull(),
    objectId: text('object_id').notNull(),
    objectVersion: integer('object_version'),
    result: text('result', { enum: ['ok', 'denied', 'failed'] }).notNull(),
    reason: text('reason'),
    traceId: text('trace_id'),
    prevHash: text('prev_hash'),
    hash: text('hash').notNull(),
    createdAt: timestamptz('created_at').notNull(),
  },
  (t) => [
    index('audit_events_chain').on(t.tenantId, t.brandId, t.seq),
    isolation(
      'audit_events_isolation',
      sql`tenant_id = ${currentTenant} and (brand_id is null or brand_id = any(${currentBrands}))`,
    ),
  ],
);
