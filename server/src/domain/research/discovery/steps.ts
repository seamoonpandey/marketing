// The steps of one discovery run (workflows/research-discovery.ts). Each opens its own withBrand transaction and
// returns plain JSON, which DBOS stores so a retry does not repeat it.
import { eq } from 'drizzle-orm';
import { discoveryRuns, type SearchResult } from '../../../db/schema/research.ts';
import { withBrand } from '../../../db/tenant.ts';
import { BudgetError, HttpError } from '../../../http/errors.ts';
import { logger } from '../../../log.ts';
import { search, type SearchHit, type SearchKind } from '../../../search/index.ts';
import { getBrand } from '../../brands/index.ts';
import { cleanUrl } from './match.ts';

const RUN_TYPE = 'research_discovery';

export type Query = { query: string; kind: SearchKind };
export type Searched = { hits: SearchHit[]; failed: boolean };

/** The run's keywords and the brand's country, read once the owner has confirmed. */
export async function loadDiscovery(brandId: string, runId: string): Promise<{ keywords: string[]; country: string }> {
  return withBrand(brandId, async (tx) => {
    const [run] = await tx.select({ keywords: discoveryRuns.keywords }).from(discoveryRuns).where(eq(discoveryRuns.id, runId));
    return { keywords: run!.keywords, country: (await getBrand(tx, brandId)).country };
  });
}

/** One paid query; a hit's link is kept only when http(s). BudgetError is rethrown; any other error is a failed query. */
export async function runSearch(brandId: string, runId: string, query: string, kind: SearchKind, country: string): Promise<Searched> {
  try {
    const hits = await search({ brandId, runType: RUN_TYPE, runId, query, kind, country });
    return { hits: hits.map((h) => ({ ...h, url: h.url ? cleanUrl(h.url) : null })), failed: false };
  } catch (e) {
    if (e instanceof BudgetError) throw e;
    logger.warn({ err: e, runId, kind }, 'discovery search failed');
    return { hits: [], failed: true };
  }
}

/**
 * Every query again, in one step, after each failed once. A failed query is a step that succeeded, so a retry of the run
 * would only replay the failures; this step throws when they all fail again, so the retry starts here and searches again.
 */
export async function searchAgain(brandId: string, runId: string, queries: Query[], country: string): Promise<Searched[]> {
  const answers: Searched[] = [];
  for (const q of queries) answers.push(await runSearch(brandId, runId, q.query, q.kind, country));
  if (answers.every((a) => a.failed)) throw new HttpError(503, 'search_failed', 'Every search failed; retry the run');
  return answers;
}

export async function saveResults(brandId: string, runId: string, results: SearchResult[]): Promise<void> {
  await withBrand(brandId, (tx) => tx.update(discoveryRuns).set({ results }).where(eq(discoveryRuns.id, runId)));
}
