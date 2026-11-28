import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { config } from '../config.ts';
import type { Money } from '../contracts/common.ts';
import { tenantOf, withBrand } from '../db/tenant.ts';
import { estimateCost, recordCost, remainingMonthlyCap } from '../domain/costs/index.ts';
import { BudgetError, HttpError } from '../http/errors.ts';
import { mockSearch } from './mock.ts';
import { serperSearch } from './serper.ts';

export { mockSearch } from './mock.ts';
export { serperSearch } from './serper.ts';

export type SearchKind = 'web' | 'places';
export type Place = {
  address: string | null; category: string | null; rating: number | null; ratingCount: number | null; phone: string | null; cid: string | null;
};
/** For a Maps hit `url` is the listing's website, or null. */
export type SearchHit = { title: string; url: string | null; snippet: string; place: Place | null };

export class SearchUnavailable extends HttpError {
  constructor() {
    super(503, 'search_unavailable', 'Search is not set up: set SERPER_API_KEY');
  }
}

/** Throws SearchUnavailable (503) when the real provider has no key. */
export function searchReady(): void {
  if (config.SEARCH_PROVIDER === 'serper' && !config.SERPER_API_KEY) throw new SearchUnavailable();
}

/** The price of one query: one input "token" at the endpoint's rate (ai/registry.ts). */
export function searchPrice(kind: SearchKind): Money {
  return estimateCost(`${config.SEARCH_PROVIDER}:${kind}`, 1, 0);
}

/**
 * One web or Maps query: checks the tenant's monthly cap (BudgetError, shared with the model), calls the
 * provider, and records a cost_events row for every query, failed or not. Results are untrusted data.
 */
export async function search(o: {
  brandId: string; runType: string; runId: string; query: string; kind: SearchKind; country: string;
}): Promise<SearchHit[]> {
  const model = `${config.SEARCH_PROVIDER}:${o.kind}`;
  const estimate = searchPrice(o.kind);
  const cost = { id: randomUUID(), brandId: o.brandId, runType: o.runType, runId: o.runId, model };
  // As ai.extract: the check and a reserving cost row commit together under the tenant's lock.
  await withBrand(o.brandId, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`ai-cap:${await tenantOf(tx)}`}, 0))`);
    const remaining = await remainingMonthlyCap(tx);
    if (Number(estimate.npr) > Number(remaining.npr))
      throw new BudgetError(`This search may cost NPR ${estimate.npr}; NPR ${remaining.npr} of this month's AI budget is left`);
    await recordCost(tx, { ...cost, inputTokens: 1, outputTokens: 0, ok: false });
  });
  // A throw leaves the reserved row as is (ok false, still priced: the provider may have billed it).
  const hits =
    config.SEARCH_PROVIDER === 'mock'
      ? await mockSearch.run(o.kind, o.query, o.country)
      : await serperSearch(o.query, o.kind, o.country, config.SERPER_API_KEY!);
  await withBrand(o.brandId, (tx) => recordCost(tx, { ...cost, inputTokens: 1, outputTokens: 0, ok: true }));
  return hits;
}
