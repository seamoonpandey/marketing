import { describe, expect, it } from 'vitest';
import { serperSearch } from './serper.ts';

const answer = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('serperSearch', () => {
  it('asks Serper for 10 web results in the brand country with the key', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fetchFn = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response('{}');
    }) as unknown as typeof fetch;
    await serperSearch('momo kathmandu', 'web', 'NP', 'k', fetchFn);
    expect(seen!.url).toBe('https://google.serper.dev/search');
    expect((seen!.init.headers as Record<string, string>)['X-API-KEY']).toBe('k');
    expect(JSON.parse(seen!.init.body as string)).toEqual({ q: 'momo kathmandu', gl: 'np', num: 10 });
  });

  it('maps organic results to hits with no place', async () => {
    const hits = await serperSearch('q', 'web', 'NP', 'k', answer({ organic: [{ title: 'Momo Hut', link: 'https://momohut.com.np/', snippet: 'Best momo in Lalitpur' }] }));
    expect(hits).toEqual([{ title: 'Momo Hut', url: 'https://momohut.com.np/', snippet: 'Best momo in Lalitpur', place: null }]);
  });

  it('maps Maps listings to hits with their place, keeping at most 20', async () => {
    const listing = (i: number) => ({
      title: `Cafe ${i}`, address: 'Jhamsikhel', category: 'Cafe', rating: 4.4, ratingCount: 120, phoneNumber: '+977 1', website: i === 0 ? undefined : 'https://c.example/', cid: '123',
    });
    let url = '';
    const fetchFn = (async (u: string) => {
      url = u;
      return new Response(JSON.stringify({ places: Array.from({ length: 25 }, (_, i) => listing(i)) }));
    }) as unknown as typeof fetch;
    const hits = await serperSearch('cafe', 'places', 'NP', 'k', fetchFn);
    expect(url).toBe('https://google.serper.dev/places');
    expect(hits).toHaveLength(20);
    expect(hits[0]).toEqual({
      title: 'Cafe 0', url: null, snippet: 'Cafe, Jhamsikhel',
      place: { address: 'Jhamsikhel', category: 'Cafe', rating: 4.4, ratingCount: 120, phone: '+977 1', cid: '123' },
    });
    expect(hits[1]!.url).toBe('https://c.example/');
  });

  it('cuts a title to 200 and a snippet to 400 characters', async () => {
    const [h] = await serperSearch('q', 'web', 'NP', 'k', answer({ organic: [{ title: 't'.repeat(300), link: 'https://a.example/', snippet: 's'.repeat(500) }] }));
    expect(h!.title).toHaveLength(200);
    expect(h!.snippet).toHaveLength(400);
  });

  it('keeps a cut title well-formed and drops control characters', async () => {
    const title = `${'t'.repeat(199)}\u{1F600}tail`; // the 200th unit is the emoji's first half
    const [h] = await serperSearch('q', 'web', 'NP', 'k', answer({ organic: [{ title, link: 'https://a.example/', snippet: 'a\u0000b' }] }));
    expect(h!.title.isWellFormed()).toBe(true);
    expect(h!.snippet).toBe('ab');
  });

  it('cleans place strings and keeps only finite numbers', async () => {
    const [h] = await serperSearch('q', 'places', 'NP', 'k', answer({ places: [{ title: 'x', address: 'a\u0000b', rating: 'high', ratingCount: Infinity }] }));
    expect(h!.place).toMatchObject({ address: 'ab', rating: null, ratingCount: null });
  });

  it('throws with the status on a non-2xx answer', async () => {
    await expect(serperSearch('q', 'web', 'NP', 'k', answer({}, 401))).rejects.toThrow('401');
  });
});
