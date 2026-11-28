import type { SearchHit, SearchKind } from './index.ts';

type Organic = { title?: string; link?: string; snippet?: string };
type Listing = {
  title?: string; address?: string; category?: string; rating?: number; ratingCount?: number;
  phoneNumber?: string; website?: string; cid?: string;
};

const TITLE_MAX = 200;
const SNIPPET_MAX = 400;
const PLACES_MAX = 20;

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
    body: JSON.stringify(kind === 'web' ? { q: query, gl, num: 10 } : { q: query, gl }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Serper answered ${res.status}`);
  const body = (await res.json()) as { organic?: Organic[]; places?: Listing[] };
  if (kind === 'web')
    return (body.organic ?? []).map((o) => ({
      title: (o.title ?? '').slice(0, TITLE_MAX),
      url: o.link ?? null,
      snippet: (o.snippet ?? '').slice(0, SNIPPET_MAX),
      place: null,
    }));
  return (body.places ?? []).slice(0, PLACES_MAX).map((p) => ({
    title: (p.title ?? '').slice(0, TITLE_MAX),
    url: p.website ?? null,
    snippet: [p.category, p.address].filter(Boolean).join(', ').slice(0, SNIPPET_MAX),
    place: {
      address: p.address ?? null,
      category: p.category ?? null,
      rating: p.rating ?? null,
      ratingCount: p.ratingCount ?? null,
      phone: p.phoneNumber ?? null,
      cid: p.cid ?? null,
    },
  }));
}
