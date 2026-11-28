import { and, eq, inArray } from 'drizzle-orm';
import { discoveryCandidates } from '../../../db/schema/research.ts';
import type { Tx } from '../../../db/tenant.ts';
import { foldText } from '../../../text/normalise.ts';

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

/** Makes each candidate a competitor with watched pages; `unreadable` holds the IDs of those whose site gave no pages. */
export async function watchCandidates(brandId: string, ids: string[]): Promise<{ watched: Candidate[]; unreadable: string[] }> {
  throw new Error('not built: watchCandidates');
}

export async function dismissCandidate(tx: Tx, brandId: string, id: string): Promise<Candidate> {
  throw new Error('not built: dismissCandidate');
}

export async function restoreCandidate(tx: Tx, brandId: string, id: string): Promise<Candidate> {
  throw new Error('not built: restoreCandidate');
}
