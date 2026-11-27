import { sql } from 'drizzle-orm';
import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { platforms } from '../../domain/publish/capabilities.ts';
import { brandColumns, brandPolicies } from './core.ts';

const id = () => uuid('id').primaryKey().default(sql`uuidv7()`);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

export const jobStates = ['scheduled', 'publishing', 'awaiting_manual', 'published', 'unknown', 'blocked', 'failed', 'cancelled'] as const;
export const channelStatuses = ['connected', 'needs_reconnect', 'disabled'] as const;

export const publishChannels = pgTable(
  'channels',
  {
    id: id(),
    ...brandColumns,
    platform: text('platform', { enum: platforms }).notNull(),
    mode: text('mode', { enum: ['manual', 'api'] }).notNull().default('manual'),
    connector: text('connector', { enum: ['manual', 'mock'] }).notNull().default('manual'),
    accountName: text('account_name').notNull(),
    accountUrl: text('account_url'),
    status: text('status', { enum: channelStatuses }).notNull().default('connected'),
    lastVerifiedAt: timestamptz('last_verified_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('channels_account').on(t.brandId, t.platform, t.accountName), ...brandPolicies('channels')],
);

export const publishJobs = pgTable(
  'publish_jobs',
  {
    id: id(),
    ...brandColumns,
    draftId: uuid('draft_id').notNull(),
    draftVersion: integer('draft_version').notNull(),
    payloadHash: text('payload_hash').notNull(),
    channelId: uuid('channel_id').notNull(),
    scheduledAt: timestamptz('scheduled_at').notNull(),
    state: text('state', { enum: jobStates }).notNull().default('scheduled'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamptz('next_attempt_at'),
    idempotencyKey: text('idempotency_key').notNull(),
    externalId: text('external_id'),
    externalUrl: text('external_url'),
    error: text('error'),
    retryable: boolean('retryable').notNull().default(false),
    publishedAt: timestamptz('published_at'),
    manual: boolean('manual').notNull().default(false),
    workflowId: text('workflow_id'),
    /** When the send that holds the job claimed it; the sweep turns a claim older than 15 minutes into unknown. */
    claimedAt: timestamptz('claimed_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('publish_jobs_idempotency_key').on(t.idempotencyKey),
    // One active job per draft and channel, enforced by the database so two racing requests store one.
    uniqueIndex('publish_jobs_one_active')
      .on(t.brandId, t.draftId, t.channelId)
      .where(sql`state not in ('published', 'cancelled', 'failed')`),
    index('publish_jobs_due').on(t.brandId, t.state, t.scheduledAt),
    ...brandPolicies('publish_jobs'),
  ],
);

export const publishSettings = pgTable(
  'publish_settings',
  {
    id: id(),
    ...brandColumns,
    windowStart: integer('window_start').notNull().default(7),
    windowEnd: integer('window_end').notNull().default(21),
    maxAttempts: integer('max_attempts').notNull().default(3),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('publish_settings_brand').on(t.brandId), ...brandPolicies('publish_settings')],
);
