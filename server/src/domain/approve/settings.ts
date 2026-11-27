import { eq } from 'drizzle-orm';
import { approveSettings } from '../../db/schema/approve.ts';
import type { Tx } from '../../db/tenant.ts';
import { ValidationError } from '../../http/errors.ts';
import { audit } from '../audit/index.ts';
import { plain } from './risk.ts';

export type ApproveSettings = { maxAgeDays: number; approvers: string[]; paused: boolean; pausedReason: string | null; pausedAt: Date | null };

const DEFAULTS: ApproveSettings = { maxAgeDays: 14, approvers: [], paused: false, pausedReason: null, pausedAt: null };

export async function getSettings(tx: Tx, brandId: string): Promise<ApproveSettings> {
  const [r] = await tx.select().from(approveSettings).where(eq(approveSettings.brandId, brandId));
  return r ? { maxAgeDays: r.maxAgeDays, approvers: r.approvers, paused: r.paused, pausedReason: r.pausedReason, pausedAt: r.pausedAt } : { ...DEFAULTS };
}

export async function setSettings(tx: Tx, brandId: string, s: { maxAgeDays: number; approvers: string[] }): Promise<ApproveSettings> {
  if (!Number.isInteger(s.maxAgeDays) || s.maxAgeDays < 1 || s.maxAgeDays > 90) throw new ValidationError('maxAgeDays is 1 to 90');
  const approvers = s.approvers.map((a) => a.trim());
  if (approvers.some((a) => !a || a.length > 100)) throw new ValidationError('An approver name is 1 to 100 characters');
  const v = { maxAgeDays: s.maxAgeDays, approvers };
  await tx.insert(approveSettings).values({ brandId, ...v }).onConflictDoUpdate({ target: approveSettings.brandId, set: v });
  await audit(tx, { brandId, actor: 'operator', action: 'approve.settings.set', objectType: 'approve_settings', objectId: brandId, result: 'ok' });
  return getSettings(tx, brandId);
}

/** The emergency pause. Nothing is deleted; while paused no approval is valid. Both directions need a reason and are audited. */
export async function setPaused(tx: Tx, brandId: string, paused: boolean, reason: string): Promise<ApproveSettings> {
  const why = (reason ?? '').trim();
  if (!plain(why)) throw new ValidationError(`${paused ? 'Pausing' : 'Resuming'} needs a reason`);
  const v = { paused, pausedReason: paused ? why : null, pausedAt: paused ? new Date() : null };
  await tx.insert(approveSettings).values({ brandId, ...v }).onConflictDoUpdate({ target: approveSettings.brandId, set: v });
  await audit(tx, { brandId, actor: 'operator', action: paused ? 'approve.pause' : 'approve.resume', objectType: 'approve_settings', objectId: brandId, result: 'ok', reason: why });
  return getSettings(tx, brandId);
}
