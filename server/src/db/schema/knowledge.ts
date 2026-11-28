// Facts, subjects, assets, palette, import runs.
import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { brandColumns, brandPolicies, runColumns, sources } from './core.ts';

const id = () => uuid('id').primaryKey().default(sql`uuidv7()`);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

/** Stored statuses. `expired` is computed on read: approved with expires_at in the past. */
export const storedFactStatuses = ['approved', 'unverified', 'inferred', 'conflicting', 'rejected'] as const;
export const factOrigins = ['stated', 'inferred', 'owner'] as const;
export const assetKinds = ['logo', 'font', 'photo', 'other'] as const;
export const paletteRoles = ['primary', 'secondary', 'accent', 'text', 'background'] as const;
export const paletteOrigins = ['logo', 'site', 'guide', 'owner'] as const;
export const importStages = ['fetch', 'estimate', 'extract', 'verify', 'done'] as const;

export type FactLocator = { page?: number; quote?: string };
export type AssetRights = {
  owner?: string; licence?: string; territory?: string; channels?: string[]; commercialUse?: boolean;
  paidUse?: boolean; term?: string; expiresAt?: string; attribution?: string; modelRelease?: boolean;
};
export type ImportCounts = {
  pages?: number; pagesFailed?: number; files?: number; batches?: number;
  unverified?: number; inferred?: number; conflicts?: number; unchanged?: number; dropped?: number; colours?: number;
  /** 1 when a logo was found on the website and stored for the owner to confirm. */
  logos?: number;
};

/** Products and audience segments: the subjects facts other than the brand's own are about. */
export const subjects = pgTable(
  'subjects',
  {
    id: id(),
    ...brandColumns,
    type: text('type', { enum: ['product', 'segment'] }).notNull(),
    name: text('name').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('subjects_brand').on(t.brandId, t.type), ...brandPolicies('subjects')],
);

/** Append-only: a change inserts a new version and clears is_current on the one it supersedes. */
export const facts = pgTable(
  'facts',
  {
    id: id(),
    ...brandColumns,
    section: text('section').notNull(),
    subjectId: uuid('subject_id').references(() => subjects.id),
    field: text('field').notNull(),
    value: jsonb('value').notNull(),
    unit: text('unit'),
    language: text('language').notNull(),
    status: text('status', { enum: storedFactStatuses }).notNull(),
    origin: text('origin', { enum: factOrigins }).notNull(),
    confidence: numeric('confidence', { precision: 3, scale: 2 }),
    sourceId: uuid('source_id').references(() => sources.id),
    locator: jsonb('locator').$type<FactLocator>(),
    warning: text('warning'),
    version: integer('version').notNull().default(1),
    supersedesId: uuid('supersedes_id'),
    isCurrent: boolean('is_current').notNull().default(true),
    verifiedBy: text('verified_by'),
    verifiedAt: timestamptz('verified_at'),
    expiresAt: timestamptz('expires_at'),
    importRunId: uuid('import_run_id'),
    createdAt: createdAt(),
  },
  (t) => [
    index('facts_current_key').on(t.brandId, t.section, t.field, t.subjectId).where(sql`is_current`),
    // One successor per version, so a fact's history is a single line.
    uniqueIndex('facts_supersedes').on(t.supersedesId),
    ...brandPolicies('facts'),
  ],
);

export const assets = pgTable(
  'assets',
  {
    id: id(),
    ...brandColumns,
    sourceId: uuid('source_id').notNull().references(() => sources.id),
    kind: text('kind', { enum: assetKinds }).notNull(),
    variant: text('variant'),
    rights: jsonb('rights').$type<AssetRights>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index('assets_brand').on(t.brandId), ...brandPolicies('assets')],
);

/** Exact colours read from logos, site CSS or the guide. The owner's role assignment is their approval. */
export const paletteColours = pgTable(
  'palette_colours',
  {
    id: id(),
    ...brandColumns,
    hex: text('hex').notNull(),
    role: text('role', { enum: paletteRoles }),
    origin: text('origin', { enum: paletteOrigins }).notNull(),
    share: numeric('share', { precision: 5, scale: 4 }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('palette_colours_brand_hex').on(t.brandId, t.hex), ...brandPolicies('palette_colours')],
);

export const importRuns = pgTable(
  'import_runs',
  {
    id: id(),
    ...brandColumns,
    websiteUrl: text('website_url'),
    sourceIds: uuid('source_ids').array().notNull().default(sql`'{}'::uuid[]`),
    stage: text('stage', { enum: importStages }).notNull().default('fetch'),
    counts: jsonb('counts').$type<ImportCounts>().notNull().default({}),
    ...runColumns,
    /** Why the run cannot be confirmed (the estimate exceeds the remaining monthly cap). */
    blocked: text('blocked'),
    /** The DBOS workflow now carrying the run; a retry forks a new one. */
    workflowId: text('workflow_id'),
    createdAt: createdAt(),
  },
  (t) => [index('import_runs_brand').on(t.brandId, t.createdAt), ...brandPolicies('import_runs')],
);
