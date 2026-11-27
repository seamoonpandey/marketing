// The two screens' reads: the queue (with its summary) and the exact-version preview.
import type { z } from '@hono/zod-openapi';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type * as C from '../../contracts/approve.ts';
import type { ApprovedFact } from '../../contracts/common.ts';
import { approvals, approvalViews } from '../../db/schema/approve.ts';
import type { Tx } from '../../db/tenant.ts';
import { NotFoundError } from '../../http/errors.ts';
import { presignDownload, underPrefix } from '../../storage/index.ts';
import { getSettings as getPlanSettings, weekStartOf } from '../plan/index.ts';
import { alreadyDecided, expiryFor, foreignRenders, history, recordView, refusal, riskOfDraft, ruleContext, stateOf, type RuleContext } from './decisions.ts';
import { payloadHash, payloadOf } from './hash.ts';
import type { Approval, ApprovalState } from './state.ts';
import { draftOf, type ReadyDraft, type StudioReads } from './studio.ts';

type Decision = z.infer<typeof C.Decision>;
type Kind = z.infer<typeof C.QueueDraft>['kind'];
const RISK_ORDER = { high: 0, medium: 1, low: 2 } as const;
const HIGH_IN_BULK = 'high risk: approve it on its own with a review note';

export const toDecision = (a: Approval): Decision => ({
  id: a.id, draftId: a.objectId, version: a.objectVersion, decision: a.decision, payloadHash: a.payloadHash, risk: a.risk, reason: a.reason,
  reviewNote: a.reviewNote, decidedBy: a.decidedBy, decidedAt: a.decidedAt.toISOString(), expiresAt: a.expiresAt?.toISOString() ?? null, bulkId: a.bulkId,
});

function excerptOf(content: unknown): string {
  const copies = (content as { copies?: { sentences?: { text?: unknown }[] }[] } | null)?.copies;
  const text = (Array.isArray(copies) && Array.isArray(copies[0]?.sentences) ? copies[0].sentences : [])
    .map((s) => (typeof s?.text === 'string' ? s.text : '')).join(' ').trim();
  const chars = [...text];
  return chars.length > 140 ? `${chars.slice(0, 139).join('')}…` : text;
}

/** What the screens need to know about deciding on a draft now. Shared by the queue and the preview. */
function decidability(ctx: RuleContext, d: ReadyDraft, latest: Approval | null) {
  const payload = payloadOf(d);
  const hash = payload && payloadHash(payload);
  const risk = riskOfDraft(ctx, d);
  return {
    hash, risk,
    cannotApprove: refusal(ctx, d, 'approve') ?? alreadyDecided(ctx, d, latest, 'approve'),
    cannotReject: refusal(ctx, d, 'reject') ?? alreadyDecided(ctx, d, latest, 'reject'),
    blockingCount: d.findings.filter((f) => f.blocking).length + (foreignRenders(ctx, d).length ? 1 : 0),
  };
}

const firstImage = (ctx: RuleContext, d: ReadyDraft) => d.renders.find((r) => r.type !== 'video' && underPrefix(ctx.keyPrefix, r.key));

/** Ready drafts and drafts with a decision, each with its state today; counts over all of them, items filtered by state. */
export async function queue(tx: Tx, brandId: string, facts: ApprovedFact[], studio: StudioReads, filter: { state?: ApprovalState } = {}): Promise<z.infer<typeof C.Queue>> {
  const ctx = await ruleContext(tx, brandId, facts);
  const drafts = await studio.listDrafts(tx, brandId, ctx.facts);
  const latest = new Map(
    (await tx.selectDistinctOn([approvals.objectId]).from(approvals)
      .where(and(eq(approvals.brandId, brandId), eq(approvals.objectType, 'studio_draft')))
      .orderBy(approvals.objectId, desc(approvals.objectVersion), desc(approvals.seq)))
      .map((a) => [a.objectId, a]),
  );
  const byId = new Map(drafts.map((d) => [d.id, d]));
  const ids = [...new Set([...drafts.filter((d) => payloadOf(d) || latest.has(d.id)).map((d) => d.id), ...latest.keys()])];
  const seen = new Set(
    ids.length
      ? (await tx.select().from(approvalViews).where(and(eq(approvalViews.brandId, brandId), inArray(approvalViews.objectId, ids))))
        .map((v) => `${v.objectId}:${v.objectVersion}:${v.payloadHash}`)
      : [],
  );
  const { weekStarts } = await getPlanSettings(tx, brandId);

  const items: z.infer<typeof C.QueueItem>[] = [];
  for (const id of ids) {
    const d = byId.get(id) ?? null;
    const l = latest.get(id) ?? null;
    const s = stateOf(ctx, l, d);
    let draft: z.infer<typeof C.QueueDraft> | null = null;
    if (d) {
      const x = decidability(ctx, d, l);
      const viewed = !!x.hash && seen.has(`${d.id}:${d.currentVersion}:${x.hash}`);
      const img = firstImage(ctx, d);
      draft = {
        version: d.currentVersion, kind: d.kind as Kind, status: d.status, channel: d.channel, day: d.day, weekStart: weekStartOf(d.day, weekStarts),
        excerpt: excerptOf(d.content), thumbnailUrl: img ? await presignDownload(img.key) : null,
        risk: x.risk.risk, riskReasons: x.risk.reasons, payloadHash: x.hash, blockingCount: x.blockingCount, viewed,
        canApprove: !x.cannotApprove, cannotApproveReason: x.cannotApprove, noteRequired: x.risk.risk === 'high',
        bulkReason: x.cannotApprove ?? (x.risk.risk === 'high' ? HIGH_IN_BULK : viewed ? null : 'open its preview first'),
      };
    }
    items.push({ draftId: id, state: s.state, stateReason: s.reason ?? null, draft, latest: l && toDecision(l) });
  }
  items.sort((a, b) =>
    !a.draft || !b.draft ? Number(!a.draft) - Number(!b.draft) || a.draftId.localeCompare(b.draftId)
    : a.draft.day.localeCompare(b.draft.day) || RISK_ORDER[a.draft.risk] - RISK_ORDER[b.draft.risk] || a.draftId.localeCompare(b.draftId));

  const counts = { waiting: 0, approved: 0, rejected: 0, invalid: 0, expired: 0, paused: 0 };
  for (const i of items) counts[i.state]++;
  const [month] = await tx.select({ n: sql<number>`count(*)::int` }).from(approvals)
    .where(and(eq(approvals.brandId, brandId), gte(approvals.decidedAt, sql`date_trunc('month', now(), 'UTC')`)));
  return {
    summary: {
      counts, paused: ctx.settings.paused, pausedReason: ctx.settings.pausedReason, pausedAt: ctx.settings.pausedAt?.toISOString() ?? null,
      monthDecisions: month?.n ?? 0,
    },
    items: filter.state ? items.filter((i) => i.state === filter.state) : items,
  };
}

/** The exact version that would go out, its state and every decision on it. record: note that this payload was viewed. */
export async function preview(
  tx: Tx, brandId: string, draftId: string, facts: ApprovedFact[], studio: StudioReads, opts: { record: boolean },
): Promise<z.infer<typeof C.Preview>> {
  const ctx = await ruleContext(tx, brandId, facts);
  const d = await draftOf(studio, tx, brandId, draftId, ctx.facts);
  const hist = await history(tx, brandId, draftId);
  if (!d && !hist.length) throw new NotFoundError('studio_draft', draftId);
  const latest = hist[0] ?? null;
  const s = stateOf(ctx, latest, d);
  let draft: z.infer<typeof C.PreviewDraft> | null = null;
  if (d) {
    const x = decidability(ctx, d, latest);
    if (x.hash && opts.record) await recordView(tx, brandId, d.id, d.currentVersion, x.hash);
    const cited = new Set(d.factIds);
    draft = {
      version: d.currentVersion, kind: d.kind as Kind, status: d.status, channel: d.channel, day: d.day,
      weekStart: weekStartOf(d.day, (await getPlanSettings(tx, brandId)).weekStarts), pillar: d.pillar, campaignId: d.campaignId,
      content: d.content as z.infer<typeof C.PreviewDraft>['content'], leftOut: d.leftOut as z.infer<typeof C.PreviewDraft>['leftOut'],
      findings: [...d.findings, ...(foreignRenders(ctx, d).length ? [{ check: 'render_location', blocking: true, where: 'renders', message: 'A rendered file is not stored under this brand, so it is left out of this preview.' }] : [])].sort((a, b) => Number(b.blocking) - Number(a.blocking)) as z.infer<typeof C.PreviewDraft>['findings'],
      blockingCount: x.blockingCount,
      facts: ctx.facts.filter((f) => cited.has(f.id)).map((f) => ({
        id: f.id, section: f.section, subjectName: f.subjectName, field: f.field, value: f.value, unit: f.unit, expiresAt: f.expiresAt,
      })),
      missingFactIds: d.factIds.filter((id) => !ctx.approvedFactIds.has(id)),
      renders: await Promise.all(d.renders.filter((r) => underPrefix(ctx.keyPrefix, r.key)).map(async (r, i) => ({
        ratio: r.ratio, width: r.width, height: r.height, overflow: r.overflow, index: r.index ?? i, type: r.type ?? 'image', url: await presignDownload(r.key),
      }))),
      risk: x.risk.risk, riskReasons: x.risk.reasons, payloadHash: x.hash,
      expiresIfApproved: x.cannotApprove ? null : expiryFor(ctx, d).toISOString(),
      noteRequired: x.risk.risk === 'high', canApprove: !x.cannotApprove, cannotApproveReason: x.cannotApprove,
      canReject: !x.cannotReject, cannotRejectReason: x.cannotReject,
    };
  }
  return {
    draftId: d?.id ?? latest!.objectId, state: s.state, stateReason: s.reason ?? null, paused: ctx.settings.paused, draft,
    history: hist.map(toDecision),
  };
}
