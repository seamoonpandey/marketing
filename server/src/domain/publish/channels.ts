import { and, asc, eq } from 'drizzle-orm';
import { publishChannels } from '../../db/schema/publish.ts';
import type { Tx } from '../../db/tenant.ts';
import { ConflictError, NotFoundError, ValidationError } from '../../http/errors.ts';
import { audit } from '../audit/index.ts';
import { isPlatform, type Platform } from './capabilities.ts';
import { isUuid } from './reads.ts';

export type Channel = typeof publishChannels.$inferSelect;

/**
 * A plain http or https URL, or a ValidationError. Anything else (javascript:, data:) could run when shown as a link; a
 * user name (https://facebook.com@evil.example) or a control character makes it read as another link than it is.
 */
export function httpUrl(s: string, what = 'The link'): string {
  let u: URL;
  if (/[\u0000-\u001f\u007f]/.test(s.trim())) throw new ValidationError(`${what} has a control character`);
  try {
    u = new URL(s.trim());
  } catch {
    throw new ValidationError(`${what} is not a URL`);
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new ValidationError(`${what} must start with https:// or http://`);
  if (u.username || u.password) throw new ValidationError(`${what} must not carry a user name or password`);
  return u.toString();
}

/** The link if it is a plain http or https URL, else null. For links a connector answers. */
export function safeLink(s: string): string | null {
  try {
    return httpUrl(s);
  } catch {
    return null;
  }
}

export async function listChannels(tx: Tx, brandId: string): Promise<Channel[]> {
  return tx.select().from(publishChannels).where(eq(publishChannels.brandId, brandId)).orderBy(asc(publishChannels.platform), asc(publishChannels.accountName));
}

/** The brand's channel, or null. */
export async function findChannel(tx: Tx, brandId: string, id: string): Promise<Channel | null> {
  if (!isUuid(id)) return null;
  const [c] = await tx.select().from(publishChannels).where(and(eq(publishChannels.id, id), eq(publishChannels.brandId, brandId)));
  return c ?? null;
}

export async function getChannel(tx: Tx, brandId: string, id: string): Promise<Channel> {
  const c = await findChannel(tx, brandId, id);
  if (!c) throw new NotFoundError('channel', id);
  return c;
}

const name = (s: string) => {
  const n = s.trim();
  if (!n || n.length > 100) throw new ValidationError('The account name is 1 to 100 characters');
  return n;
};
const taken = (platform: string, accountName: string) => new ConflictError(`${platform} account ${accountName} is already a channel`);

/** A manual channel: the owner posts by hand. The mock connector is for tests only and has no route. */
export async function createChannel(
  tx: Tx, brandId: string, i: { platform: string; accountName: string; accountUrl?: string | null; connector?: 'manual' | 'mock' },
): Promise<Channel> {
  if (!isPlatform(i.platform)) throw new ValidationError(`Unknown platform: ${i.platform}`);
  const connector = i.connector ?? 'manual';
  const [c] = await tx
    .insert(publishChannels)
    .values({
      brandId, platform: i.platform as Platform, accountName: name(i.accountName), accountUrl: i.accountUrl ? httpUrl(i.accountUrl, 'The account link') : null,
      connector, mode: connector === 'manual' ? 'manual' : 'api', status: 'connected', lastVerifiedAt: new Date(),
    })
    .onConflictDoNothing()
    .returning();
  if (!c) throw taken(i.platform, i.accountName.trim());
  await audit(tx, { brandId, actor: 'operator', action: 'publish.channel.create', objectType: 'channel', objectId: c.id, result: 'ok', reason: `${c.platform} ${c.accountName}` });
  return c;
}

export async function updateChannel(
  tx: Tx, brandId: string, id: string, p: { accountName?: string; accountUrl?: string | null; status?: 'connected' | 'disabled' },
): Promise<Channel> {
  const c = await getChannel(tx, brandId, id);
  const v: Partial<Channel> = {};
  if (p.accountName !== undefined) v.accountName = name(p.accountName);
  if (p.accountUrl !== undefined) v.accountUrl = p.accountUrl ? httpUrl(p.accountUrl, 'The account link') : null;
  if (p.status !== undefined) {
    if (p.status !== 'connected' && p.status !== 'disabled') throw new ValidationError('status is connected or disabled');
    v.status = p.status;
    if (p.status === 'connected') v.lastVerifiedAt = new Date();
  }
  if (!Object.keys(v).length) return c;
  if (v.accountName && v.accountName !== c.accountName) {
    const [dup] = await tx.select({ id: publishChannels.id }).from(publishChannels)
      .where(and(eq(publishChannels.brandId, brandId), eq(publishChannels.platform, c.platform), eq(publishChannels.accountName, v.accountName)));
    if (dup) throw taken(c.platform, v.accountName);
  }
  const [row] = await tx.update(publishChannels).set(v).where(and(eq(publishChannels.id, id), eq(publishChannels.brandId, brandId))).returning();
  await audit(tx, {
    brandId, actor: 'operator', action: 'publish.channel.update', objectType: 'channel', objectId: id, result: 'ok',
    reason: Object.keys(v).filter((k) => k !== 'lastVerifiedAt').map((k) => (k === 'status' ? `status ${c.status} → ${v.status}` : k)).join(', '),
  });
  return row!;
}
