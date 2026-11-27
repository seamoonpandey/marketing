import type { approvals } from '../../db/schema/approve.ts';
import { payloadHash, payloadOf } from './hash.ts';
import { plain } from './risk.ts';
import type { ReadyDraft } from './studio.ts';

export type Approval = typeof approvals.$inferSelect;
export type ApprovalState = 'waiting' | 'approved' | 'rejected' | 'invalid' | 'expired' | 'paused';

const DAY = 86_400_000;
/** The shortest review note a high-risk approval takes. */
export const MIN_NOTE = 20;
/** A review note counts only its visible characters, so padding and invisible characters do not make it long enough. */
export const noteLength = (note: string | null | undefined) => [...plain(note ?? '')].length;

/**
 * A decision's state today. Never stored: worked out on every read, so an approval stops being valid
 * the moment anything it depends on changes, without anyone revoking it.
 */
export function approvalState(i: {
  latest: Approval | null; draft: ReadyDraft | null; now: Date; paused: boolean;
  approvedFactIds: Set<string>; assetsWithRights: Set<string>; highRisk?: boolean;
}): { state: ApprovalState; reason?: string } {
  const { latest, draft } = i;
  const payload = draft && payloadOf(draft);
  if (!latest) return payload ? { state: 'waiting' } : { state: 'waiting', reason: 'Not ready: the draft is back in Studio' };
  // A newer ready version needs its own decision. A draft that is not ready is not waiting for one.
  if (payload && latest.objectVersion < payload.version) return { state: 'waiting' };
  if (latest.decision === 'rejected') return { state: 'rejected', ...(latest.reason ? { reason: latest.reason } : {}) };
  if (!draft) return { state: 'invalid', reason: 'Studio no longer has this draft' };
  if (!payload) return { state: 'invalid', reason: 'The draft changed or is no longer ready' };
  if (payloadHash(payload) !== latest.payloadHash) return { state: 'invalid', reason: 'The draft changed after it was approved' };
  // Studio works its checks out against today's facts and rules, so a draft can become blocked without changing.
  if (draft.findings.some((f) => f.blocking)) return { state: 'invalid', reason: 'A blocking issue was found since it was approved' };
  if (draft.factIds.some((id) => !i.approvedFactIds.has(id))) return { state: 'invalid', reason: 'A cited fact is no longer approved' };
  if (draft.assetIds.some((id) => !i.assetsWithRights.has(id))) return { state: 'invalid', reason: 'A used asset has no rights' };
  // Risk is read against today's industry and rules, so an unchanged draft can turn high risk after a bulk or note-less approval.
  if (i.highRisk && (latest.bulkId || noteLength(latest.reviewNote) < MIN_NOTE)) return { state: 'invalid', reason: 'It is high risk now: approve it on its own with a review note' };
  if (!latest.expiresAt || latest.expiresAt.getTime() <= i.now.getTime()) return { state: 'expired', reason: 'The approval expired' };
  if (i.paused) return { state: 'paused', reason: 'Approvals are paused for this brand' };
  return { state: 'approved' };
}

/** The earliest of: decidedAt plus the brand's validity days, the cited facts' expiries, the used assets' rights expiries. */
export function expiryOf(i: { decidedAt: Date; maxAgeDays: number; factExpiries: (Date | null)[]; rightsExpiries: (Date | null)[] }): Date {
  const others = [...i.factExpiries, ...i.rightsExpiries].filter((d): d is Date => d !== null).map((d) => d.getTime());
  return new Date(Math.min(i.decidedAt.getTime() + i.maxAgeDays * DAY, ...others));
}
