import { and, asc, eq } from 'drizzle-orm';
import { watchTargets } from '../../db/schema/research.ts';
import type { Tx } from '../../db/tenant.ts';
import { ConflictError, NotFoundError, ValidationError } from '../../http/errors.ts';
import { audit } from '../audit/index.ts';
import { getBrand, listCompetitors } from '../brands/index.ts';
import { pickPages } from '../sources/index.ts';

export const MAX_TARGETS_PER_COMPETITOR = 5;
export const MAX_COMPETITORS = 10;

export type WatchTarget = typeof watchTargets.$inferSelect;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const host = (u: URL) => u.hostname.replace(/^www\./, '').toLowerCase();

/** Pages of a competitor's site worth watching (the base picker, at most 5). */
export function suggestTargets(competitorSite: string): Promise<string[]> {
  return pickPages(competitorSite, MAX_TARGETS_PER_COMPETITOR);
}

export async function listTargets(tx: Tx, brandId: string, competitorId?: string): Promise<WatchTarget[]> {
  return tx
    .select()
    .from(watchTargets)
    .where(and(eq(watchTargets.brandId, brandId), competitorId ? eq(watchTargets.competitorId, competitorId) : undefined))
    .orderBy(asc(watchTargets.createdAt));
}

export async function addTarget(
  tx: Tx, brandId: string, i: { competitorId: string; url: string; label?: string },
): Promise<WatchTarget> {
  let url: URL;
  try {
    url = new URL(i.url);
  } catch {
    throw new ValidationError(`Not a URL: ${i.url}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new ValidationError('Only http and https pages can be watched');
  url.hash = '';

  if (!(await listCompetitors(tx, brandId)).some((c) => c.id === i.competitorId)) throw new NotFoundError('competitor', i.competitorId);
  const own = (await getBrand(tx, brandId)).website;
  if (own) {
    let ownUrl: URL | undefined;
    try {
      ownUrl = new URL(/^https?:\/\//i.test(own) ? own : `https://${own}`);
    } catch {}
    if (ownUrl && host(ownUrl) === host(url)) throw new ValidationError("That page is on the brand's own site; only competitors' pages are watched");
  }

  const all = await listTargets(tx, brandId);
  if (all.some((t) => t.url === url.href)) throw new ConflictError('That page is already on the watch list');
  const mine = all.filter((t) => t.competitorId === i.competitorId);
  if (mine.length >= MAX_TARGETS_PER_COMPETITOR)
    throw new ValidationError(`A competitor can have at most ${MAX_TARGETS_PER_COMPETITOR} watched pages`);
  if (!mine.length && new Set(all.map((t) => t.competitorId)).size >= MAX_COMPETITORS)
    throw new ValidationError(`A brand can watch at most ${MAX_COMPETITORS} competitors`);

  const [row] = await tx
    .insert(watchTargets)
    .values({ brandId, competitorId: i.competitorId, url: url.href, label: i.label ?? null })
    .returning();
  await audit(tx, { brandId, actor: 'operator', action: 'research.target.add', objectType: 'watch_target', objectId: row!.id, result: 'ok' });
  return row!;
}

async function getTarget(tx: Tx, brandId: string, id: string): Promise<WatchTarget> {
  const [row] = UUID.test(id)
    ? await tx.select().from(watchTargets).where(and(eq(watchTargets.id, id), eq(watchTargets.brandId, brandId)))
    : [];
  if (!row) throw new NotFoundError('watch_target', id);
  return row;
}

/** Pause, or resume (which also clears a failure mark). */
export async function setTargetStatus(tx: Tx, brandId: string, id: string, status: 'active' | 'paused'): Promise<WatchTarget> {
  await getTarget(tx, brandId, id);
  const [row] = await tx
    .update(watchTargets)
    .set({ status, ...(status === 'active' ? { failCount: 0, lastError: null } : {}) })
    .where(eq(watchTargets.id, id))
    .returning();
  await audit(tx, { brandId, actor: 'operator', action: `research.target.${status}`, objectType: 'watch_target', objectId: id, result: 'ok' });
  return row!;
}

export async function removeTarget(tx: Tx, brandId: string, id: string): Promise<void> {
  await getTarget(tx, brandId, id);
  await tx.delete(watchTargets).where(eq(watchTargets.id, id));
  await audit(tx, { brandId, actor: 'operator', action: 'research.target.remove', objectType: 'watch_target', objectId: id, result: 'ok' });
}
