import { and, eq, inArray, sql } from 'drizzle-orm';
import { discoveryCandidates } from '../../../db/schema/research.ts';
import { isUuid, withBrand, type Tx } from '../../../db/tenant.ts';
import { ConflictError, NotFoundError, ValidationError } from '../../../http/errors.ts';
import { foldText } from '../../../text/normalise.ts';
import { audit } from '../../audit/index.ts';
import { createCompetitor } from '../../brands/index.ts';
import { addTarget, listTargets, MAX_COMPETITORS, suggestTargets } from '../targets.ts';
import { siteHost } from './match.ts';

export type Candidate = typeof discoveryCandidates.$inferSelect;

const OVERLAP = ['high', 'medium', 'low'];
// The overlap cell is model-written, so it is folded before it is compared; a missing or other value sorts as none.
const overlapRank = (c: Candidate) => {
  const i = OVERLAP.indexOf(foldText(c.cells.overlap?.value ?? ''));
  return i < 0 ? OVERLAP.length : i;
};

/** Without a status: new and watched. Sorted by overlap (high, medium, low, none), then rank. */
export async function listCandidates(tx: Tx, brandId: string, status?: 'new' | 'watched' | 'dismissed'): Promise<Candidate[]> {
  const rows = await tx
    .select().from(discoveryCandidates)
    .where(and(
      eq(discoveryCandidates.brandId, brandId),
      status ? eq(discoveryCandidates.status, status) : inArray(discoveryCandidates.status, ['new', 'watched']),
    ));
  return rows.sort((a, b) => overlapRank(a) - overlapRank(b) || a.rank - b.rank);
}

const KINDS = ['direct', 'indirect', 'aspirational'] as const;
const NETWORKS: [string, string[]][] = [
  ['facebook', ['facebook.com', 'fb.com']], ['instagram', ['instagram.com']], ['tiktok', ['tiktok.com']],
  ['youtube', ['youtube.com', 'youtu.be']], ['x', ['x.com', 'twitter.com']], ['linkedin', ['linkedin.com']],
];

/** One handle per network, valued with its first link; a link over the 200 characters a handle allows is left out. */
function handlesOf(channels: string[]): Record<string, string> {
  const handles: Record<string, string> = {};
  for (const url of channels) {
    const host = siteHost(url) ?? '';
    const network = NETWORKS.find(([, hosts]) => hosts.some((h) => host === h || host.endsWith(`.${h}`)))?.[0];
    if (network && !handles[network] && url.length <= 200) handles[network] = url;
  }
  return handles;
}

/**
 * Makes each candidate a competitor (name, kind, site, social handles) and adds the suggested pages of each one with a
 * readable site. Refuses the whole request when those would take more watch slots than are free. `unreadable` holds the
 * IDs of candidates whose site gave no pages; they are still watched, with no pages.
 */
export async function watchCandidates(brandId: string, ids: string[]): Promise<{ watched: Candidate[]; unreadable: string[] }> {
  const wanted = [...new Set(ids)];
  const picked = await withBrand(brandId, async (tx) => {
    const rows = await tx
      .select().from(discoveryCandidates)
      .where(and(eq(discoveryCandidates.brandId, brandId), inArray(discoveryCandidates.id, wanted.filter(isUuid))));
    const missing = wanted.find((id) => !rows.some((r) => r.id === id));
    if (missing !== undefined) throw new NotFoundError('discovery_candidate', missing);
    if (rows.some((r) => r.status !== 'new')) throw new ConflictError('Already watched or hidden');
    return wanted.map((id) => rows.find((r) => r.id === id)!);
  });

  // Outside any transaction: reading a site can take seconds.
  const pages = new Map<string, string[]>();
  for (const c of picked) if (c.site) pages.set(c.id, await suggestTargets(c.site).catch(() => []));
  const unreadable = [...pages].filter(([, urls]) => !urls.length).map(([id]) => id);

  const watched = await withBrand(brandId, async (tx) => {
    // addTarget's lock, taken before counting, so simultaneous requests cannot each count the same free slot.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`watch-targets:${brandId}`}, 0))`);
    const free = MAX_COMPETITORS - new Set((await listTargets(tx, brandId)).map((t) => t.competitorId)).size;
    if (picked.filter((c) => pages.get(c.id)?.length).length > free)
      throw new ValidationError(`You can watch ${Math.max(free, 0)} more competitors with a website; untick some`);
    const out: Candidate[] = [];
    for (const c of picked) {
      const competitor = await createCompetitor(tx, brandId, {
        name: c.name, kind: KINDS.find((k) => k === foldText(c.cells.kind?.value ?? '')) ?? 'direct', site: c.site, handles: handlesOf(c.channels),
      });
      const [row] = await tx
        .update(discoveryCandidates).set({ status: 'watched', competitorId: competitor.id })
        .where(and(eq(discoveryCandidates.id, c.id), eq(discoveryCandidates.status, 'new')))
        .returning();
      if (!row) throw new ConflictError('Already watched or hidden'); // changed while its site was read
      // A page addTarget refuses (on the brand's own site, or already watched for another competitor) is skipped.
      for (const url of pages.get(c.id) ?? [])
        await addTarget(tx, brandId, { competitorId: competitor.id, url }).catch((e) => {
          if (!(e instanceof ValidationError || e instanceof ConflictError)) throw e;
        });
      await audit(tx, { brandId, actor: 'operator', action: 'research.candidate.watch', objectType: 'discovery_candidate', objectId: c.id, result: 'ok' });
      out.push(row);
    }
    return out;
  });
  return { watched, unreadable };
}

async function getCandidate(tx: Tx, brandId: string, id: string): Promise<Candidate> {
  const [row] = isUuid(id)
    ? await tx.select().from(discoveryCandidates).where(and(eq(discoveryCandidates.id, id), eq(discoveryCandidates.brandId, brandId)))
    : [];
  if (!row) throw new NotFoundError('discovery_candidate', id);
  return row;
}

/** Moves a candidate between new and dismissed; its cells and dates stay. */
async function move(tx: Tx, brandId: string, id: string, to: 'new' | 'dismissed'): Promise<Candidate> {
  const from = to === 'new' ? 'dismissed' : 'new';
  const refused = new ConflictError(to === 'new' ? 'This candidate is not hidden' : 'Already watched or hidden');
  if ((await getCandidate(tx, brandId, id)).status !== from) throw refused;
  // Only from the status just read, so a watch request that commits in between is not overwritten.
  const [row] = await tx
    .update(discoveryCandidates).set({ status: to, dismissedAt: to === 'dismissed' ? new Date() : null })
    .where(and(eq(discoveryCandidates.id, id), eq(discoveryCandidates.status, from)))
    .returning();
  if (!row) throw refused;
  await audit(tx, {
    brandId, actor: 'operator', action: `research.candidate.${to === 'new' ? 'restore' : 'dismiss'}`, objectType: 'discovery_candidate',
    objectId: id, result: 'ok',
  });
  return row;
}

/** "Not a competitor": hides a new candidate. */
export const dismissCandidate = (tx: Tx, brandId: string, id: string): Promise<Candidate> => move(tx, brandId, id, 'dismissed');

/** Puts a hidden candidate back with the cells it last had. */
export const restoreCandidate = (tx: Tx, brandId: string, id: string): Promise<Candidate> => move(tx, brandId, id, 'new');
