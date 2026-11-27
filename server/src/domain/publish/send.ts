// Sending one job. Each part is its own DBOS step, so after a crash a finished part is not run again and
// an unfinished send runs again with the same idempotency key, which the platform treats as the same post.
import { randomUUID } from 'node:crypto';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { and, asc, eq, lte, sql } from 'drizzle-orm';
import { publishJobs } from '../../db/schema/publish.ts';
import { withBrand, withTenant, type Tx } from '../../db/tenant.ts';
import { logger } from '../../log.ts';
import { listBrands } from '../brands/index.ts';
import { approvedFacts } from '../knowledge/index.ts';
import { findChannel } from './channels.ts';
import { connectorFor, ConnectorError, type Connector, type PublishRequest } from './connectors/index.ts';
import { copiesOf, isVideo, mediaFor } from './fit.ts';
import { applyOutcome, auditJob, dueAt, getJob, type Job } from './jobs.ts';
import { approvalOf, draftOf, reads, type DraftForPublish, type Reads } from './reads.ts';
import { getSettings } from './settings.ts';
import { isMissed, MISSED, type Outcome } from './state.ts';

export type SendDeps = { reads?: Reads; connector?: Connector; now?: () => Date; sleep?: (seconds: number) => Promise<void> };

const RECONCILE_AFTER = [60, 300, 900];
const step = <T>(name: string, fn: () => Promise<T>) => DBOS.runStep(fn, { name });
const due = sql`coalesce(${publishJobs.nextAttemptAt}, ${publishJobs.scheduledAt})`;

export type DueJob = { brandId: string; jobId: string; idempotencyKey: string; attempts: number; dueAt: string };

/** Scheduled jobs whose time (or retry time) has come, across the tenant's active brands. One brand failing never stops the others. */
export async function dueJobs(now: Date): Promise<DueJob[]> {
  const out: DueJob[] = [];
  for (const b of (await withTenant(listBrands)).filter((b) => b.status === 'active')) {
    try {
      const rows = await withBrand(b.id, (tx) =>
        tx.select({ id: publishJobs.id, idempotencyKey: publishJobs.idempotencyKey, attempts: publishJobs.attempts, dueAt: due.mapWith(publishJobs.scheduledAt) })
          .from(publishJobs)
          .where(and(eq(publishJobs.brandId, b.id), eq(publishJobs.state, 'scheduled'), lte(due, now)))
          .orderBy(asc(due))
          .limit(100),
      );
      out.push(...rows.map((r) => ({ brandId: b.id, jobId: r.id, idempotencyKey: r.idempotencyKey, attempts: r.attempts, dueAt: r.dueAt.toISOString() })));
    } catch (err) {
      logger.error({ err, brandId: b.id }, 'publish: listing due jobs failed for one brand');
    }
  }
  return out;
}

/**
 * Claims a due scheduled job with one conditional update; null when another worker has it or it is not
 * due. A re-run of this step by the same workflow after a crash finds its own claim.
 */
async function claim(tx: Tx, brandId: string, jobId: string, token: string, now: Date): Promise<{ dueAt: string } | null> {
  const [row] = await tx
    .update(publishJobs)
    .set({ state: 'publishing', workflowId: token, attempts: sql`${publishJobs.attempts} + 1` })
    .where(and(eq(publishJobs.id, jobId), eq(publishJobs.brandId, brandId), eq(publishJobs.state, 'scheduled'), lte(due, now)))
    .returning();
  if (row) {
    await auditJob(tx, brandId, row, 'claim', 'scheduled', 'publishing', `attempt ${row.attempts}`, 'system');
    return { dueAt: dueAt(row).toISOString() };
  }
  const [mine] = await tx.select().from(publishJobs)
    .where(and(eq(publishJobs.id, jobId), eq(publishJobs.brandId, brandId), eq(publishJobs.state, 'publishing'), eq(publishJobs.workflowId, token)));
  return mine ? { dueAt: dueAt(mine).toISOString() } : null;
}

/** Applies an outcome to the job this worker claimed. Anything else that changed the job meanwhile wins. */
async function apply(brandId: string, jobId: string, token: string, o: Outcome, now: Date): Promise<string> {
  return withBrand(brandId, async (tx) => {
    const job = await getJob(tx, brandId, jobId);
    const r = await applyOutcome(tx, brandId, job, o, { maxAttempts: (await getSettings(tx, brandId)).maxAttempts, now, actor: 'system', claim: token });
    if (r.refused) logger.warn({ brandId, jobId, outcome: o.type, refused: r.refused }, 'publish: outcome not applied');
    return r.job.state;
  });
}

type Gated = { ok: true; draft: Pick<DraftForPublish, 'kind' | 'content' | 'renders'> } | { ok: false; reason: string };

/** The gate, asked again at send time: the valid approval must carry the hash and version the job was scheduled with. */
async function gate(tx: Tx, brandId: string, job: Job, r: Reads): Promise<Gated> {
  const facts = await approvedFacts(tx, brandId);
  const before = await draftOf(r, tx, brandId, job.draftId, facts);
  if (!before) return { ok: false, reason: 'The draft no longer exists' };
  const approval = await approvalOf(r, tx, brandId, job.draftId, facts);
  if (!approval) return { ok: false, reason: 'The approval no longer stands: the draft changed, the approval expired or was withdrawn, or the brand is paused' };
  if (approval.payloadHash !== job.payloadHash || approval.objectVersion !== job.draftVersion || before.currentVersion !== job.draftVersion)
    return { ok: false, reason: 'The draft was changed or approved again after this job was scheduled' };
  // Read the draft again: what is sent must be what the gate saw, not an edit that landed in between.
  const after = await draftOf(r, tx, brandId, job.draftId, facts);
  const same = (d: DraftForPublish | null) => d && JSON.stringify([d.currentVersion, d.content, d.renders]);
  if (same(after) !== same(before)) return { ok: false, reason: 'The draft changed while it was being checked' };
  return { ok: true, draft: { kind: before.kind, content: before.content, renders: before.renders } };
}

/** The post: the first language's caption with its call to action, its hashtags, and the media in the platform's shape. */
export function requestFor(draft: Pick<DraftForPublish, 'kind' | 'content' | 'renders'>, channel: { platform: string; accountName: string }): PublishRequest {
  const [copy] = copiesOf(draft.content);
  const { items } = mediaFor(draft as DraftForPublish, channel.platform);
  return {
    platform: channel.platform, accountName: channel.accountName,
    caption: copy ? [copy.caption, copy.cta].filter(Boolean).join('\n\n') : '', hashtags: copy?.hashtags ?? [],
    media: items.map((m) => ({ key: m.key, ratio: m.ratio, kind: isVideo(m) ? 'video' : 'image' })),
  };
}

const current = (brandId: string, jobId: string) => withBrand(brandId, (tx) => getJob(tx, brandId, jobId));

/** Sends one job: claim, missed-time check, gate, channel, send, then reconcile an unknown result. */
export async function sendJob(brandId: string, jobId: string, deps: SendDeps = {}): Promise<Job> {
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? ((s: number) => DBOS.sleep(s * 1000));
  const token = DBOS.workflowID ?? randomUUID();
  const done = async (o: Outcome) => {
    await step('apply', async () => apply(brandId, jobId, token, o, now()));
    return current(brandId, jobId);
  };

  // 1. Claim. Only a run that made the claim itself may send: a resumed run gets the claim from the stored step while
  // its first run may still be sending, so it leaves the job publishing rather than send beside it.
  let claimedHere = false;
  const claimed = await step('claim', () =>
    withBrand(brandId, async (tx) => {
      const c = await claim(tx, brandId, jobId, token, now());
      claimedHere = c !== null;
      return c;
    }),
  );
  if (!claimed) return current(brandId, jobId);

  let sending = false;
  try {
    // 2. A job more than 24 hours past its time is not sent.
    if (await step('missed', async () => isMissed(new Date(claimed.dueAt), now()))) return await done({ type: 'gate_refused', reason: MISSED });

    // 3. The channel.
    const channel = await step('channel', () =>
      withBrand(brandId, async (tx) => {
        const job = await getJob(tx, brandId, jobId);
        const c = await findChannel(tx, brandId, job.channelId);
        return c && { platform: c.platform, accountName: c.accountName, mode: c.mode, connector: c.connector, status: c.status, key: job.idempotencyKey };
      }),
    );
    if (!channel) return await done({ type: 'channel_unavailable', reason: 'The channel was removed' });
    if (channel.status !== 'connected')
      return await done({ type: 'channel_unavailable', reason: channel.status === 'disabled' ? 'The channel is disabled' : 'The channel needs reconnecting' });

    // 4. The gate and the send, in one step: a resumed run replays a finished step's stored answer, so only a gate asked
    // inside this step is asked right before sending. Sends with the job's one idempotency key, only while this run
    // still holds the claim. Never throws: every answer becomes an outcome; null is not ours to send.
    const connector = connectorFor(channel, deps.connector);
    sending = true;
    const outcome = await step('send', async (): Promise<Outcome | null> => {
      if (!claimedHere) return null;
      let gated: Outcome | Extract<Gated, { ok: true }> | null;
      try {
        const r = deps.reads ?? (await reads());
        gated = await withBrand(brandId, async (tx): Promise<typeof gated> => {
          const job = await getJob(tx, brandId, jobId);
          if (job.state !== 'publishing' || job.workflowId !== token) return null;
          if ((await findChannel(tx, brandId, job.channelId))?.status !== 'connected') return { type: 'channel_unavailable', reason: 'The channel is no longer connected' };
          const g = await gate(tx, brandId, job, r);
          return g.ok ? g : { type: 'gate_refused', reason: g.reason };
        });
      } catch (e) {
        logger.error({ err: e, brandId, jobId }, 'publish: the check before sending failed');
        return { type: 'error', kind: 'server' }; // nothing was sent
      }
      if (!gated || 'type' in gated) return gated;
      try {
        const res = await connector.publish(requestFor(gated.draft, channel), channel.key);
        return res.status === 'manual' ? { type: 'manual' } : { type: 'sent', externalId: res.externalId, url: res.url };
      } catch (e) {
        // Anything but a typed answer may have reached the platform: treat it as a timeout and reconcile.
        if (e instanceof ConnectorError) return { type: 'error', kind: e.kind, retryAfterSeconds: e.retryAfterSeconds };
        logger.error({ err: e, brandId, jobId }, 'publish: connector threw an untyped error');
        return { type: 'error', kind: 'timeout' };
      }
    });
    if (!outcome) return current(brandId, jobId);
    let state = await step('apply', async () => apply(brandId, jobId, token, outcome, now()));

    // After a timeout, look for the post before anything is sent again; stop at the first clear answer.
    for (const [i, wait] of RECONCILE_AFTER.entries()) {
      if (state !== 'unknown') break;
      await sleep(wait);
      const found = await step(`reconcile:${i}`, () => connector.reconcile(channel.key).catch(() => ({ found: 'unknown' as const })));
      state = await step(`apply:reconcile:${i}`, async () => apply(brandId, jobId, token, { type: 'reconciled', result: found }, now()));
    }
    return current(brandId, jobId);
  } catch (e) {
    // Before the send nothing went out, so it is retried like a server error; after it, nobody knows.
    await step('fail', async () => apply(brandId, jobId, token, { type: 'error', kind: sending ? 'timeout' : 'server' }, now())).catch(() => {});
    throw e;
  }
}
