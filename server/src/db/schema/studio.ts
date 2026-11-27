// Owned by the studio branch (docs/structure.md).
import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { brandColumns, brandPolicies, runColumns } from './core.ts';

const id = () => uuid('id').primaryKey().default(sql`uuidv7()`);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const draftKinds = ['post', 'static', 'carousel', 'video'] as const;
export const ratios = ['1:1', '4:5', '9:16', '16:9'] as const;
export const templates = ['headline', 'offer', 'quote'] as const;
export type DraftKind = (typeof draftKinds)[number];
export type Ratio = (typeof ratios)[number];
export type TemplateName = (typeof templates)[number];

export type StoredSentence = { text: string; claim: boolean; factIds: string[] };
export type StoredCopy = { language: string; sentences: StoredSentence[]; hashtags: string[]; cta: string };
export type StoredSlide = { headline: string; subline?: string; badge?: string; photoAssetId?: string };
export type StoredScene = { onScreenText: string; voiceover: string; shot: string; seconds: number };
export type DraftContent = {
  copies: StoredCopy[]; slides: StoredSlide[]; scenes: StoredScene[]; template: TemplateName; ratios: Ratio[];
  /** The plan item's channel when the draft was made, used if the item is later deleted. */
  channel: string;
};
export type LeftOut = { language: string; text: string; reason: string };
/** One rendered file. `index` is the slide or scene number; a video is index 0 with type 'video'. */
export type RenderRecord = { ratio: Ratio; key: string; width: number; height: number; overflow: boolean; index: number; type: 'image' | 'video' };
export type StudioCounts = {
  drafted?: number;
  failed?: number;
  rendered?: number;
  failures?: { planItemId: string; message: string }[];
  missingLanguages?: { planItemId: string; languages: string[] }[];
};

export const studioDrafts = pgTable(
  'studio_drafts',
  {
    id: id(),
    ...brandColumns,
    planItemId: uuid('plan_item_id').notNull(),
    kind: text('kind', { enum: draftKinds }).notNull(),
    status: text('status', { enum: ['draft', 'ready'] }).notNull().default('draft'),
    currentVersion: integer('current_version').notNull().default(1),
    readyVersion: integer('ready_version'),
    readyAt: timestamp('ready_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('studio_drafts_item').on(t.brandId, t.planItemId), ...brandPolicies('studio_drafts')],
);

export const studioVersions = pgTable(
  'studio_versions',
  {
    id: id(),
    ...brandColumns,
    draftId: uuid('draft_id').notNull(),
    version: integer('version').notNull(),
    origin: text('origin', { enum: ['model', 'owner'] }).notNull(),
    content: jsonb('content').$type<DraftContent>().notNull(),
    leftOut: jsonb('left_out').$type<LeftOut[]>().notNull().default([]),
    renders: jsonb('renders').$type<RenderRecord[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('studio_versions_draft').on(t.draftId, t.version), ...brandPolicies('studio_versions')],
);

export const studioRuns = pgTable(
  'studio_runs',
  {
    id: id(),
    ...brandColumns,
    kind: text('kind', { enum: ['generate', 'render'] }).notNull(),
    /** Plan item ids for a generate run, the draft id for a render run. */
    targets: jsonb('targets').$type<string[]>().notNull().default([]),
    counts: jsonb('counts').$type<StudioCounts>().notNull().default({}),
    workflowId: text('workflow_id'),
    ...runColumns,
    createdAt: createdAt(),
  },
  (t) => [index('studio_runs_brand').on(t.brandId, t.createdAt), ...brandPolicies('studio_runs')],
);
