import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { ApprovedFact } from '../../contracts/common.ts';
import { approvals, approvalViews } from '../../db/schema/approve.ts';
import { assets } from '../../db/schema/knowledge.ts';
import type { Tx } from '../../db/tenant.ts';
import { ConflictError, NotFoundError, ValidationError } from '../../http/errors.ts';
import { audit } from '../audit/index.ts';
import { getSettings as getPlanSettings } from '../plan/index.ts';
import { payloadHash, payloadOf } from './hash.ts';
import { plain, riskOf, textOf } from './risk.ts';
import { getSettings, type ApproveSettings } from './settings.ts';
import { approvalState, expiryOf, type Approval } from './state.ts';
import { draftOf, isUuid, studioReads, type ReadyDraft, type StudioReads } from './studio.ts';

export const CHANGED = 'changed since you opened it';
const DAY = 86_400_000;
const MIN_NOTE = 20;

/** Everything the rules read besides the draft and its decisions, as of one instant. */
export type RuleContext = {
  now: Date; settings: ApproveSettings; facts: ApprovedFact[]; approvedFactIds: Set<string>;
  factExpiry: Map<string, Date | null>;
  /** Assets with a licence recorded and not past their rights expiry, with that expiry. */
  rights: Map<string, Date | null>;
  industry: string | null;
};

export async function ruleContext(tx: Tx, brandId: string, facts: ApprovedFact[]): Promise<RuleContext> {
  const now = new Date();
  // A fact past its expiry is not approved today, whatever list the caller passed.
  const live = facts.filter((f) => !f.expiresAt || Date.parse(f.expiresAt) > now.getTime());
  const rights = new Map<string, Date | null>();
  for (const a of await tx.select({ id: assets.id, rights: assets.rights }).from(assets).where(eq(assets.brandId, brandId))) {
    const licensed = typeof a.rights.licence === 'string' && a.rights.licence.trim() !== '';
    const until = a.rights.expiresAt ? new Date(a.rights.expiresAt) : null; // unparsable: NaN, never in the future
    if (licensed && (!until || until.getTime() > now.getTime())) rights.set(a.id, until);
  }
  const industry = live
    .filter((f) => f.section === 'identity' && (f.field === 'industry' || f.field === 'sub_industry'))
    .map((f) => (typeof f.value === 'string' ? f.value : JSON.stringify(f.value)))
    .join(' ');
  return {
    now, settings: await getSettings(tx, brandId), facts: live, approvedFactIds: new Set(live.map((f) => f.id)),
    factExpiry: new Map(live.map((f) => [f.id, f.expiresAt ? new Date(f.expiresAt) : null])), rights, industry: industry || null,
  };
}

export const stateOf = (ctx: RuleContext, latest: Approval | null, draft: ReadyDraft | null) =>
  approvalState({ latest, draft, now: ctx.now, paused: ctx.settings.paused, approvedFactIds: ctx.approvedFactIds, assetsWithRights: new Set(ctx.rights.keys()) });

export const riskOfDraft = (ctx: RuleContext, d: ReadyDraft) => riskOf({ text: textOf(d.content), pillar: d.pillar, industry: ctx.industry });

/** The expiry an approval of this draft given now would get. */
export const expiryFor = (ctx: RuleContext, d: ReadyDraft) =>
  expiryOf({
    decidedAt: ctx.now, maxAgeDays: ctx.settings.maxAgeDays,
    factExpiries: d.factIds.map((id) => ctx.factExpiry.get(id) ?? null), rightsExpiries: d.assetIds.map((id) => ctx.rights.get(id) ?? null),
  });

/** Why a decision on this draft would be refused now, or null. Without sentHash the current payload is assumed (for the screens). */
export function refusal(ctx: RuleContext, d: ReadyDraft, kind: 'approve' | 'reject', sentHash?: string): string | null {
  const payload = payloadOf(d);
  if (!payload) return 'not ready';
  if (sentHash !== undefined && payloadHash(payload) !== sentHash) return CHANGED;
  if (kind === 'reject') return null;
  const blocking = d.findings.find((f) => f.blocking);
  if (blocking) return `blocked: ${blocking.message}`;
  if (d.factIds.some((id) => !ctx.approvedFactIds.has(id))) return 'a cited fact is not approved';
  if (d.assetIds.some((id) => !ctx.rights.has(id))) return 'a used asset has no rights';
  return null;
}

/**
 * Why the latest decision on the draft's current version rules out a new one, or null. An approval that expired or
 * became invalid can be renewed, an approval can be withdrawn with a reject, and a rejected version approved after all.
 */
export function alreadyDecided(ctx: RuleContext, d: ReadyDraft, latest: Approval | null, kind: 'approve' | 'reject'): string | null {
  if (!latest || latest.objectVersion !== d.currentVersion) return null;
  if (latest.decision === 'rejected') return kind === 'reject' ? 'this version is already rejected' : null;
  if (kind === 'reject') return null;
  const { state } = stateOf(ctx, latest, d);
  return state === 'expired' || state === 'invalid' ? null : 'this version is already approved';
}

/** The seq a new decision on the draft's current version takes. */
const nextSeq = (d: ReadyDraft, latest: Approval | null) => (latest?.objectVersion === d.currentVersion ? latest.seq + 1 : 1);

const latestOf = async (tx: Tx, brandId: string, draftId: string) => (await history(tx, brandId, draftId))[0] ?? null;

/** A review note counts only its visible characters, so padding and invisible characters do not make it long enough. */
export const noteLength = (note: string | undefined) => [...plain(note ?? '')].length;

async function mustDraft(studio: StudioReads, tx: Tx, brandId: string, draftId: string, ctx: RuleContext): Promise<ReadyDraft> {
  const d = await draftOf(studio, tx, brandId, draftId, ctx.facts);
  if (!d) throw new NotFoundError('studio_draft', draftId);
  return d;
}

type NewDecision = typeof approvals.$inferInsert & { brandId: string; objectId: string; objectVersion: number; payloadHash: string };

// The unique index decides a race: of two inserts of one seq for one version, the second stores nothing.
async function store(tx: Tx, v: NewDecision): Promise<Approval> {
  const [row] = await tx.insert(approvals).values(v).onConflictDoNothing().returning();
  if (!row) throw new ConflictError('this version was decided at the same moment: reload it');
  await audit(tx, {
    brandId: v.brandId, actor: 'operator', action: `approve.${v.decision}`, objectType: 'studio_draft', objectId: v.objectId,
    objectVersion: v.objectVersion, result: 'ok', reason: `payload ${v.payloadHash}${v.reason ? `: ${v.reason}` : ''}`,
  });
  return row;
}

function approvalOf(ctx: RuleContext, brandId: string, d: ReadyDraft, hash: string, note: string | undefined, bulkId: string | null, seq: number): NewDecision {
  return {
    brandId, objectType: 'studio_draft', objectId: d.id, objectVersion: d.currentVersion, seq, payloadHash: hash, decision: 'approved',
    risk: riskOfDraft(ctx, d).risk, reviewNote: note?.trim() || null, decidedBy: 'operator', decidedAt: ctx.now, expiresAt: expiryFor(ctx, d), bulkId,
  };
}

export async function recordView(tx: Tx, brandId: string, draftId: string, version: number, payloadHash: string): Promise<void> {
  await tx.insert(approvalViews).values({ brandId, objectType: 'studio_draft', objectId: draftId, objectVersion: version, payloadHash }).onConflictDoNothing();
}

export async function approve(
  tx: Tx, brandId: string, i: { draftId: string; payloadHash: string; reviewNote?: string }, facts: ApprovedFact[], studio?: StudioReads,
): Promise<Approval> {
  studio ??= await studioReads();
  const ctx = await ruleContext(tx, brandId, facts);
  const d = await mustDraft(studio, tx, brandId, i.draftId, ctx);
  const latest = await latestOf(tx, brandId, d.id);
  const why = refusal(ctx, d, 'approve', i.payloadHash) ?? alreadyDecided(ctx, d, latest, 'approve');
  if (why) throw new ConflictError(why);
  if (riskOfDraft(ctx, d).risk === 'high' && noteLength(i.reviewNote) < MIN_NOTE)
    throw new ConflictError(`high risk: a review note of at least ${MIN_NOTE} characters is needed`);
  return store(tx, approvalOf(ctx, brandId, d, i.payloadHash, i.reviewNote, null, nextSeq(d, latest)));
}

export async function reject(
  tx: Tx, brandId: string, i: { draftId: string; payloadHash: string; reason: string }, facts: ApprovedFact[], studio?: StudioReads,
): Promise<Approval> {
  const reason = (i.reason ?? '').trim();
  if (!plain(reason)) throw new ValidationError('A rejection needs a reason');
  studio ??= await studioReads();
  const ctx = await ruleContext(tx, brandId, facts);
  const d = await mustDraft(studio, tx, brandId, i.draftId, ctx);
  const latest = await latestOf(tx, brandId, d.id);
  const why = refusal(ctx, d, 'reject', i.payloadHash) ?? alreadyDecided(ctx, d, latest, 'reject');
  if (why) throw new ConflictError(why);
  return store(tx, {
    brandId, objectType: 'studio_draft', objectId: d.id, objectVersion: d.currentVersion, seq: nextSeq(d, latest), payloadHash: i.payloadHash, decision: 'rejected',
    reason, risk: riskOfDraft(ctx, d).risk, decidedBy: 'operator', decidedAt: ctx.now, expiresAt: null, bulkId: null,
  });
}

/** The first day of the brand's plan week (weekStarts 0 Sunday … 6) holding day. */
export function weekStartOf(day: string, weekStarts: number): string {
  const t = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(t)) return day;
  return new Date(t - ((new Date(t).getUTCDay() - weekStarts + 7) % 7) * DAY).toISOString().slice(0, 10);
}

/**
 * Approves every item or none (design section 3): one channel, one risk, one plan week, nothing high risk, each
 * previewed at the exact payload it approves, and each hash checked like a single approval.
 */
export async function bulkApprove(
  tx: Tx, brandId: string, items: { draftId: string; payloadHash: string }[], facts: ApprovedFact[], studio?: StudioReads,
): Promise<Approval[]> {
  if (!items.length) throw new ValidationError('Nothing to approve');
  studio ??= await studioReads();
  const ctx = await ruleContext(tx, brandId, facts);
  const loaded: { d: ReadyDraft; hash: string; latest: Approval | null }[] = [];
  for (const it of items) {
    const d = await mustDraft(studio, tx, brandId, it.draftId, ctx);
    loaded.push({ d, hash: it.payloadHash, latest: await latestOf(tx, brandId, d.id) });
  }
  if (new Set(loaded.map((x) => x.d.id)).size !== loaded.length) throw new ValidationError('A draft is listed twice');

  const ids = loaded.map((x) => x.d.id);
  const seen = new Set(
    (await tx.select().from(approvalViews).where(and(eq(approvalViews.brandId, brandId), inArray(approvalViews.objectId, ids))))
      .map((v) => `${v.objectId}:${v.objectVersion}:${v.payloadHash}`),
  );
  for (const { d, hash, latest } of loaded) {
    const why = refusal(ctx, d, 'approve', hash)
      ?? alreadyDecided(ctx, d, latest, 'approve')
      ?? (riskOfDraft(ctx, d).risk === 'high' ? 'high risk: approve it on its own with a review note' : null)
      ?? (seen.has(`${d.id}:${d.currentVersion}:${hash}`) ? null : 'open its preview first');
    if (why) throw new ConflictError(`${d.id}: ${why}`);
  }
  const weekStarts = (await getPlanSettings(tx, brandId)).weekStarts;
  if (new Set(loaded.map((x) => x.d.channel)).size > 1) throw new ConflictError('A bulk approval needs one channel');
  if (new Set(loaded.map((x) => riskOfDraft(ctx, x.d).risk)).size > 1) throw new ConflictError('A bulk approval needs one risk');
  if (new Set(loaded.map((x) => weekStartOf(x.d.day, weekStarts))).size > 1) throw new ConflictError('A bulk approval needs one week');

  const bulkId = randomUUID();
  const out: Approval[] = [];
  for (const { d, hash, latest } of loaded) out.push(await store(tx, approvalOf(ctx, brandId, d, hash, undefined, bulkId, nextSeq(d, latest))));
  return out;
}

/** Every decision on a draft, newest first: by version, then seq within it. */
export async function history(tx: Tx, brandId: string, draftId: string): Promise<Approval[]> {
  if (!isUuid(draftId)) return [];
  return tx.select().from(approvals)
    .where(and(eq(approvals.brandId, brandId), eq(approvals.objectType, 'studio_draft'), eq(approvals.objectId, draftId)))
    .orderBy(desc(approvals.objectVersion), desc(approvals.seq));
}

/** The gate: the draft's latest decision (highest version, then highest seq) when it is an approval that is valid right now, else null. */
export async function validApproval(tx: Tx, brandId: string, draftId: string, facts: ApprovedFact[], studio?: StudioReads): Promise<Approval | null> {
  const [latest] = await history(tx, brandId, draftId);
  if (latest?.decision !== 'approved') return null;
  studio ??= await studioReads();
  const ctx = await ruleContext(tx, brandId, facts);
  const d = await draftOf(studio, tx, brandId, draftId, ctx.facts);
  return stateOf(ctx, latest, d).state === 'approved' ? latest : null;
}
