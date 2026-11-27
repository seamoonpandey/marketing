import { sql } from 'drizzle-orm';
import { boolean, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { brandColumns, brandPolicies } from './core.ts';

const id = () => uuid('id').primaryKey().default(sql`uuidv7()`);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

export const approvalObjectTypes = ['studio_draft'] as const;
export const approvalDecisions = ['approved', 'rejected'] as const;
export const approvalRisks = ['low', 'medium', 'high'] as const;
export type ApprovalRisk = (typeof approvalRisks)[number];

// Append-only: the app role has no UPDATE or DELETE on it (db/setup.ts). State is never stored here;
// it is worked out on every read from the latest decision and today's draft.
export const approvals = pgTable(
  'approvals',
  {
    id: id(),
    ...brandColumns,
    objectType: text('object_type', { enum: approvalObjectTypes }).notNull(),
    objectId: uuid('object_id').notNull(),
    objectVersion: integer('object_version').notNull(),
    /** 1, 2, 3… within one object version: the highest is the decision that counts. */
    seq: integer('seq').notNull(),
    payloadHash: text('payload_hash').notNull(),
    decision: text('decision', { enum: approvalDecisions }).notNull(),
    reason: text('reason'),
    risk: text('risk', { enum: approvalRisks }).notNull(),
    reviewNote: text('review_note'),
    decidedBy: text('decided_by').notNull(),
    decidedAt: timestamptz('decided_at').notNull().defaultNow(),
    expiresAt: timestamptz('expires_at'),
    bulkId: uuid('bulk_id'),
    createdAt: createdAt(),
  },
  (t) => [
    // A new decision takes the latest seq of its version plus one: of two racing requests the database stores one.
    uniqueIndex('approvals_seq').on(t.brandId, t.objectType, t.objectId, t.objectVersion, t.seq),
    ...brandPolicies('approvals'),
  ],
);

// A preview opened. Keyed by the payload hash as well as the version, because Studio can re-render a
// version: a bulk approval needs the owner to have seen the files it approves, not an earlier set.
export const approvalViews = pgTable(
  'approval_views',
  {
    id: id(),
    ...brandColumns,
    objectType: text('object_type', { enum: approvalObjectTypes }).notNull(),
    objectId: uuid('object_id').notNull(),
    objectVersion: integer('object_version').notNull(),
    payloadHash: text('payload_hash').notNull(),
    viewedAt: timestamptz('viewed_at').notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('approval_views_once').on(t.brandId, t.objectType, t.objectId, t.objectVersion, t.payloadHash),
    ...brandPolicies('approval_views'),
  ],
);

export const approveSettings = pgTable(
  'approve_settings',
  {
    id: id(),
    ...brandColumns,
    paused: boolean('paused').notNull().default(false),
    pausedReason: text('paused_reason'),
    pausedAt: timestamptz('paused_at'),
    maxAgeDays: integer('max_age_days').notNull().default(14),
    approvers: jsonb('approvers').$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('approve_settings_brand').on(t.brandId), ...brandPolicies('approve_settings')],
);
