// Which search-found businesses are the same one, and which to keep (spec §5.2 step 4, §5.4). Pure.
import { cleanCut, foldText } from '../../../text/normalise.ts';

export const MAX_CANDIDATES = 30;

export type Business = { name: string; site: string | null; channels: string[]; placeCid: string | null; resultIds: string[]; rank: number };

const SOCIAL = ['facebook.com', 'fb.com', 'instagram.com', 'tiktok.com', 'youtube.com', 'youtu.be', 'x.com', 'twitter.com', 'linkedin.com', 'linktr.ee'];
const DIRECTORY = ['daraz.com.np', 'foodmandu.com', 'tripadvisor.com', 'yelp.com', 'hamrobazaar.com', 'google.com', 'goo.gl', 'wikipedia.org'];
const MAX_URL = 2048;

/** The URL, with https:// put in front of a bare domain; null unless it is http or https. */
function httpUrl(url: string): URL | null {
  const s = url.trim();
  try {
    const u = new URL(/^[a-z][a-z\d+.-]*:/i.test(s) ? s : `https://${s}`);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname ? u : null;
  } catch {
    return null;
  }
}

/** The host in lower case with no `www.` and no trailing dot; null for anything that is not http(s). */
export function siteHost(url: string): string | null {
  return httpUrl(url)?.hostname.replace(/\.$/, '').replace(/^www\./, '') ?? null;
}

const under = (host: string, seeds: string[]) => seeds.some((d) => host === d || host.endsWith(`.${d}`));

export function linkKind(url: string): 'social' | 'directory' | 'site' {
  const host = siteHost(url) ?? '';
  return under(host, SOCIAL) ? 'social' : under(host, DIRECTORY) ? 'directory' : 'site';
}

/** One business, across runs: its site host, else its Maps listing, else its folded name. */
export function matchKey(b: { site: string | null; placeCid?: string | null; name: string }): string {
  const host = b.site && siteHost(b.site);
  if (host) return `site:${host}`;
  if (b.placeCid) return `cid:${b.placeCid}`;
  // Marks stay: Devanagari vowel signs tell names apart.
  return `name:${foldText(b.name).replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim()}`;
}

/** A link a model or a search result wrote, as stored: http(s) only, cleaned; null otherwise. */
export const cleanUrl = (url: string): string | null => {
  const u = httpUrl(url);
  return u ? cleanCut(u.href, MAX_URL) : null;
};

type Result = { url: string | null; place: { cid: string | null } | null };

/**
 * The businesses worth profiling, in this order: real result IDs only, social and directory sites moved off `site`, the
 * brand's own site dropped, a site or Maps listing ID none of the business's results carries removed, duplicates merged,
 * hidden and watched ones skipped (counted), the best MAX_CANDIDATES kept.
 */
export function tidyBusinesses(
  raw: Business[], o: { ownSite: string | null; skipKeys: Set<string>; results: Map<string, Result> },
): { kept: Business[]; skipped: number } {
  const own = o.ownSite && siteHost(o.ownSite);
  const merged = new Map<string, Business>();
  for (const r of raw) {
    const resultIds = r.resultIds.filter((id) => o.results.has(id));
    const name = cleanCut(r.name, 200);
    if (!resultIds.length || !name) continue;
    const mine = resultIds.map((id) => o.results.get(id)!);
    const channels = r.channels.map(cleanUrl).filter((c): c is string => !!c);
    let site = r.site && cleanUrl(r.site);
    if (site && linkKind(site) === 'social') channels.push(site);
    if (site && linkKind(site) !== 'site') site = null;
    const host = site && siteHost(site);
    if (own && host && (host === own || host.endsWith(`.${own}`))) continue;
    // The model wrote both keys, so a snippet could point a business at another one's site or listing and have it merged
    // into that one or skipped as hidden; each is kept only when one of the business's own results carries it.
    if (host && !mine.some((x) => x.url && siteHost(x.url) === host)) site = null;
    const cid = r.placeCid && cleanCut(r.placeCid, 200);
    const placeCid = cid && mine.some((x) => x.place?.cid === cid) ? cid : null;
    const b: Business = { name, site, channels, placeCid, resultIds, rank: r.rank };
    const key = matchKey(b);
    const prev = merged.get(key);
    merged.set(key, prev ? {
      ...prev, site: prev.site ?? b.site, placeCid: prev.placeCid ?? b.placeCid, rank: Math.min(prev.rank, b.rank),
      resultIds: [...new Set([...prev.resultIds, ...b.resultIds])], channels: [...new Set([...prev.channels, ...b.channels])],
    } : { ...b, channels: [...new Set(channels)] });
  }
  // A business with no site is also skipped when its folded name is a skipped key (a hidden one or competitor with no site).
  const skip = (key: string, b: Business) => o.skipKeys.has(key) || (!b.site && o.skipKeys.has(matchKey({ site: null, name: b.name })));
  const kept = [...merged.entries()].filter(([key, b]) => !skip(key, b)).map(([, b]) => b);
  return { kept: kept.sort((a, b) => a.rank - b.rank).slice(0, MAX_CANDIDATES), skipped: merged.size - kept.length };
}
