// The steps of one discovery run (workflows/research-discovery.ts). Each opens its own withBrand transaction and
// returns plain JSON, which DBOS stores so a retry does not repeat it.
import { and, eq, inArray } from 'drizzle-orm';
import { parse } from 'node-html-parser';
import { AiError, extract } from '../../../ai/index.ts';
import { discoveryCandidates, discoveryRuns, type SearchResult } from '../../../db/schema/research.ts';
import { withBrand } from '../../../db/tenant.ts';
import { BudgetError, HttpError } from '../../../http/errors.ts';
import { logger } from '../../../log.ts';
import { search, type SearchHit, type SearchKind } from '../../../search/index.ts';
import { getObject } from '../../../storage/index.ts';
import { getBrand, listCompetitors } from '../../brands/index.ts';
import { approvedFacts } from '../../knowledge/index.ts';
import { savePageSource, saveTextSource, type Source } from '../../sources/index.ts';
import { checkCells, checkOwnRow, COLUMNS, OwnRowAnswer, RowAnswer, type OwnRow } from './cells.ts';
import { cleanUrl, linkKind, matchKey, tidyBusinesses, type Business } from './match.ts';
import {
  GROUP_MAX_OUTPUT, GROUP_SYSTEM, GroupAnswer, groupParts, OWN_MAX_OUTPUT, OWN_SYSTEM, ownParts, PAGE, PROFILE_MAX_OUTPUT, PROFILE_SYSTEM,
  profileParts, RESULTS, RESULTS_PER_BUSINESS,
} from './prompts.ts';

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

/**
 * The distinct businesses in the results (one model call), without the brand's own site, the candidates already hidden or
 * watched and the brand's competitors (counted as skipped), best first, at most MAX_CANDIDATES.
 */
export async function groupResults(brandId: string, runId: string, results: SearchResult[]): Promise<{ businesses: Business[]; skipped: number }> {
  const { ownSite, skipKeys } = await withBrand(brandId, async (tx) => {
    const held = await tx
      .select({ key: discoveryCandidates.matchKey }).from(discoveryCandidates)
      .where(and(eq(discoveryCandidates.brandId, brandId), inArray(discoveryCandidates.status, ['dismissed', 'watched'])));
    const competitors = await listCompetitors(tx, brandId);
    return {
      ownSite: (await getBrand(tx, brandId)).website,
      skipKeys: new Set([...held.map((h) => h.key), ...competitors.map((c) => matchKey({ site: c.site, name: c.name }))]),
    };
  });
  const { object } = await extract({
    brandId, runType: RUN_TYPE, runId, system: GROUP_SYSTEM, parts: groupParts(results), schema: GroupAnswer, maxOutputTokens: GROUP_MAX_OUTPUT,
  });
  const { kept, skipped } = tidyBusinesses(
    object.businesses.map((b) => ({ name: b.name, site: b.site, channels: b.socials, placeCid: b.placeCid, resultIds: b.resultIds, rank: b.rank })),
    { ownSite, skipKeys, results: new Map(results.map((r) => [r.id, r])) },
  );
  // The stored rank is the place in this run, so a model's 0.5 or 1e12 never reaches the integer column.
  return { businesses: kept.map((b, i) => ({ ...b, rank: i + 1 })), skipped };
}

/** One result as the business's text source holds it: title, link, snippet and each Maps field, one per line. */
const resultText = (r: SearchResult) =>
  [r.title, r.url, r.snippet, ...Object.entries(r.place ?? {}).filter(([k, v]) => k !== 'cid' && v !== null).map(([k, v]) => `${k}: ${v}`)]
    .filter(Boolean).join('\n');

/** The social links on a saved page's snapshot, resolved against the page and kept only when http(s). */
async function socialLinks(page: Source): Promise<string[]> {
  const html = new TextDecoder().decode(await getObject(page.objectKey));
  return parse(html).querySelectorAll('a[href]')
    .map((a) => URL.parse(a.getAttribute('href')!, page.uri)?.href)
    .filter((h): h is string => !!h && linkKind(h) === 'social')
    .map(cleanUrl).filter((h): h is string => !!h);
}

/**
 * One business's row (one model call), saved on the brand's candidate for it: a new one, or the `new` one an earlier run
 * found. A refusal or an off-schema answer loses only this row; BudgetError and a retryable failure fail the run, so a
 * retry starts again at this business.
 */
export async function profileBusiness(
  brandId: string, runId: string, b: Business, results: SearchResult[],
): Promise<{ dropped: number } | { failed: string }> {
  const key = matchKey(b);
  // The model picks which results are this business's, so the count is held to what the estimate priced.
  const mine = results.filter((r) => b.resultIds.includes(r.id)).slice(0, RESULTS_PER_BUSINESS);
  // A site that cannot be read (robots.txt, unreachable, not HTML) leaves the business its search results alone.
  const page = b.site ? await withBrand(brandId, (tx) => savePageSource(tx, brandId, b.site!, 'external')).catch(() => null) : null;
  const channels = new Set([...b.channels, ...(page ? await socialLinks(page) : [])]);
  if (b.placeCid) channels.add(`https://www.google.com/maps?cid=${encodeURIComponent(b.placeCid)}`);
  const { listing, facts } = await withBrand(brandId, async (tx) => ({
    listing: await saveTextSource(tx, brandId, `search:${runId}:${key}`, mine.map(resultText).join('\n\n')),
    facts: await approvedFacts(tx, brandId),
  }));
  const text = listing.text ?? '';
  let answer;
  try {
    ({ object: answer } = await extract({
      brandId, runType: RUN_TYPE, runId, system: PROFILE_SYSTEM, parts: profileParts(facts, b.name, text, page && (page.text ?? '')),
      schema: RowAnswer, maxOutputTokens: PROFILE_MAX_OUTPUT,
    }));
  } catch (e) {
    if (e instanceof AiError && !e.retryable) return { failed: e.message };
    throw e;
  }
  const sources = new Map([[RESULTS, text], ...(page ? [[PAGE, page.text ?? ''] as const] : [])]);
  const { cells, dropped } = checkCells(answer, { sources, factIds: new Set(facts.map((f) => f.id)) });
  // The model cites the two sources as "results" and "page"; the row keeps their stored IDs.
  const stored = new Map([[RESULTS, listing.id], ...(page ? [[PAGE, page.id] as const] : [])]);
  const id = (x: string) => stored.get(x) ?? x;
  for (const col of COLUMNS) {
    const c = cells[col];
    if (c) cells[col] = c.basis === 'quoted' ? { ...c, sourceId: id(c.sourceId) } : { ...c, evidence: c.evidence.map(id) };
  }
  const row = {
    name: b.name, site: b.site, channels: [...channels], placeCid: b.placeCid, cells, sourceIds: [...stored.values()], rank: b.rank,
    place: mine.find((r) => r.kind === 'places' && r.place)?.place ?? null, lastRunId: runId, lastFoundAt: new Date(),
  };
  await withBrand(brandId, (tx) =>
    tx.insert(discoveryCandidates).values({ brandId, matchKey: key, firstRunId: runId, ...row }).onConflictDoUpdate({
      target: [discoveryCandidates.brandId, discoveryCandidates.matchKey], set: row, setWhere: eq(discoveryCandidates.status, 'new'),
    }),
  );
  return { dropped };
}

/** The brand's own row, from its approved facts only (one model call; none without facts). A refusal leaves it empty. */
export async function fillOwnRow(brandId: string, runId: string): Promise<void> {
  const facts = await withBrand(brandId, (tx) => approvedFacts(tx, brandId));
  let ownRow: OwnRow = {};
  if (facts.length) {
    try {
      const { object } = await extract({
        brandId, runType: RUN_TYPE, runId, system: OWN_SYSTEM, parts: ownParts(facts), schema: OwnRowAnswer, maxOutputTokens: OWN_MAX_OUTPUT,
      });
      ownRow = checkOwnRow(object, new Set(facts.map((f) => f.id)));
    } catch (e) {
      if (!(e instanceof AiError && !e.retryable)) throw e;
      logger.warn({ err: e, runId }, 'discovery own row refused');
    }
  }
  await withBrand(brandId, (tx) => tx.update(discoveryRuns).set({ ownRow }).where(eq(discoveryRuns.id, runId)));
}
