import { eq } from 'drizzle-orm';
import { publishSettings } from '../../db/schema/publish.ts';
import type { Tx } from '../../db/tenant.ts';
import { ValidationError } from '../../http/errors.ts';
import { audit } from '../audit/index.ts';

/** A post may go out from windowStart:00 up to, not including, windowEnd:00, in the brand's timezone. */
export type PublishSettings = { windowStart: number; windowEnd: number; maxAttempts: number };

const DEFAULTS: PublishSettings = { windowStart: 7, windowEnd: 21, maxAttempts: 3 };

export async function getSettings(tx: Tx, brandId: string): Promise<PublishSettings> {
  const [r] = await tx.select().from(publishSettings).where(eq(publishSettings.brandId, brandId));
  return r ? { windowStart: r.windowStart, windowEnd: r.windowEnd, maxAttempts: r.maxAttempts } : { ...DEFAULTS };
}

export async function setSettings(tx: Tx, brandId: string, s: PublishSettings): Promise<PublishSettings> {
  const int = (n: unknown, lo: number, hi: number) => Number.isInteger(n) && (n as number) >= lo && (n as number) <= hi;
  if (!int(s.windowStart, 0, 23) || !int(s.windowEnd, 1, 24)) throw new ValidationError('windowStart is an hour 0 to 23 and windowEnd 1 to 24');
  if (s.windowStart >= s.windowEnd) throw new ValidationError('The publishing window must start before it ends');
  if (!int(s.maxAttempts, 1, 5)) throw new ValidationError('maxAttempts is 1 to 5');
  const v = { windowStart: s.windowStart, windowEnd: s.windowEnd, maxAttempts: s.maxAttempts };
  await tx.insert(publishSettings).values({ brandId, ...v }).onConflictDoUpdate({ target: publishSettings.brandId, set: v });
  await audit(tx, { brandId, actor: 'operator', action: 'publish.settings.set', objectType: 'publish_settings', objectId: brandId, result: 'ok' });
  return getSettings(tx, brandId);
}
