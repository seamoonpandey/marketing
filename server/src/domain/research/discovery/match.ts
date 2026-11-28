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

/** A model-written link as stored: http(s) only, cleaned. */
const cleanUrl = (url: string) => {
  const u = httpUrl(url);
  return u ? cleanCut(u.href, MAX_URL) : null;
};

/**
 * The businesses worth profiling, in this order: real result IDs only, social and directory sites moved off `site`, the
 * brand's own site dropped, duplicates merged, hidden and watched ones skipped (counted), the best MAX_CANDIDATES kept.
 */
export function tidyBusinesses(
  raw: Business[], o: { ownSite: string | null; skipKeys: Set<string>; resultIds: Set<string> },
): { kept: Business[]; skipped: number } {
  const own = o.ownSite && siteHost(o.ownSite);
  const merged = new Map<string, Business>();
  for (const r of raw) {
    const resultIds = r.resultIds.filter((id) => o.resultIds.has(id));
    const name = cleanCut(r.name, 200);
    if (!resultIds.length || !name) continue;
    const channels = r.channels.map(cleanUrl).filter((c): c is string => !!c);
    let site = r.site && cleanUrl(r.site);
    if (site && linkKind(site) === 'social') channels.push(site);
    if (site && linkKind(site) !== 'site') site = null;
    const host = site && siteHost(site);
    if (own && host && (host === own || host.endsWith(`.${own}`))) continue;
    const b: Business = { name, site, channels, placeCid: (r.placeCid && cleanCut(r.placeCid, 200)) || null, resultIds, rank: r.rank };
    const key = matchKey(b);
    const prev = merged.get(key);
    merged.set(key, prev ? {
      ...prev, site: prev.site ?? b.site, placeCid: prev.placeCid ?? b.placeCid, rank: Math.min(prev.rank, b.rank),
      resultIds: [...new Set([...prev.resultIds, ...b.resultIds])], channels: [...new Set([...prev.channels, ...b.channels])],
    } : { ...b, channels: [...new Set(channels)] });
  }
  const kept = [...merged.entries()].filter(([key]) => !o.skipKeys.has(key)).map(([, b]) => b);
  return { kept: kept.sort((a, b) => a.rank - b.rank).slice(0, MAX_CANDIDATES), skipped: merged.size - kept.length };
}
