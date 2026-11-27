import { eq } from 'drizzle-orm';
import { planSettings, type ChannelSetting, type PillarSetting } from '../../db/schema/plan.ts';
import type { Tx } from '../../db/tenant.ts';
import { ValidationError } from '../../http/errors.ts';
import { audit } from '../audit/index.ts';
import { channels, pillars } from './enums.ts';

export type PlanSettings = { channels: ChannelSetting[]; pillars: PillarSetting[]; weekStarts: number };

const DEFAULTS: PlanSettings = { channels: [], pillars: [], weekStarts: 0 };

export async function getSettings(tx: Tx, brandId: string): Promise<PlanSettings> {
  const [row] = await tx.select().from(planSettings).where(eq(planSettings.brandId, brandId));
  return row ? { channels: row.channels, pillars: row.pillars, weekStarts: row.weekStarts } : { ...DEFAULTS };
}

export async function setSettings(tx: Tx, brandId: string, s: PlanSettings): Promise<PlanSettings> {
  const seen = new Set<string>();
  for (const c of s.channels) {
    if (!(channels as readonly string[]).includes(c.channel)) throw new ValidationError(`Unknown channel: ${c.channel}`);
    if (seen.has(c.channel)) throw new ValidationError(`Channel listed twice: ${c.channel}`);
    seen.add(c.channel);
    if (!Number.isInteger(c.postsPerWeek) || c.postsPerWeek < 1 || c.postsPerWeek > 14) throw new ValidationError('postsPerWeek is 1 to 14');
  }
  const pseen = new Set<string>();
  for (const p of s.pillars) {
    if (!(pillars as readonly string[]).includes(p.pillar)) throw new ValidationError(`Unknown pillar: ${p.pillar}`);
    if (pseen.has(p.pillar)) throw new ValidationError(`Pillar listed twice: ${p.pillar}`);
    pseen.add(p.pillar);
    if (!Number.isFinite(p.weight) || p.weight < 0) throw new ValidationError('A pillar weight cannot be negative');
  }
  if (!Number.isInteger(s.weekStarts) || s.weekStarts < 0 || s.weekStarts > 6) throw new ValidationError('weekStarts is 0 (Sunday) to 6 (Saturday)');
  const v = { channels: s.channels, pillars: s.pillars, weekStarts: s.weekStarts };
  await tx.insert(planSettings).values({ brandId, ...v }).onConflictDoUpdate({ target: planSettings.brandId, set: v });
  await audit(tx, { brandId, actor: 'operator', action: 'plan.settings.set', objectType: 'plan_settings', objectId: brandId, result: 'ok' });
  return getSettings(tx, brandId);
}
