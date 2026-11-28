import { cleanCut } from '../text/normalise.ts';
import type { SearchHit, SearchKind } from './index.ts';

type Organic = { title?: string; link?: string; snippet?: string };
type Listing = {
  title?: string; address?: string; category?: string; rating?: number; ratingCount?: number;
  phoneNumber?: string; website?: string; cid?: string;
};

const cut = (s: string | null | undefined, n: number) => cleanCut(s ?? '', n);
const orNull = (s: string | null | undefined, n: number) => cut(s, n) || null;
const num = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n : null);

const TITLE_MAX = 200;
const SNIPPET_MAX = 400;
const WEB_MAX = 10; // the discovery estimate prices 10 web results and 20 listings a keyword
const PLACES_MAX = 20;
const PLACE_MAX = 300;

/** One Serper query (web: 10 organic results; places: up to 20 Maps listings) in the brand's country. */
export async function serperSearch(
  query: string,
  kind: SearchKind,
  country: string,
  apiKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<SearchHit[]> {
  const gl = country.toLowerCase();
  const res = await fetchFn(`https://google.serper.dev/${kind === 'web' ? 'search' : 'places'}`, {
    method: 'POST',
    headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(kind === 'web' ? { q: query, gl, num: WEB_MAX } : { q: query, gl }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Serper answered ${res.status}`);
  const body = (await res.json()) as { organic?: Organic[]; places?: Listing[] };
  if (kind === 'web')
    return (body.organic ?? []).slice(0, WEB_MAX).map((o) => ({
      title: cut(o.title, TITLE_MAX),
      url: o.link ?? null,
      snippet: cut(o.snippet, SNIPPET_MAX),
      place: null,
    }));
  return (body.places ?? []).slice(0, PLACES_MAX).map((p) => ({
    title: cut(p.title, TITLE_MAX),
    url: p.website ?? null,
    snippet: cut([p.category, p.address].filter(Boolean).join(', '), SNIPPET_MAX),
    place: {
      address: orNull(p.address, PLACE_MAX),
      category: orNull(p.category, PLACE_MAX),
      rating: num(p.rating),
      ratingCount: num(p.ratingCount),
      phone: orNull(p.phoneNumber, PLACE_MAX),
      cid: orNull(p.cid, PLACE_MAX),
    },
  }));
}
