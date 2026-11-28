import { describe, expect, it } from 'vitest';
import { linkKind, matchKey, siteHost, tidyBusinesses, type Business } from './match.ts';

const biz = (b: Partial<Business> & { name: string }): Business => ({ site: null, channels: [], placeCid: null, resultIds: ['r1'], rank: 1, ...b });
type Result = { url: string | null; place: { cid: string | null } | null };
// r1 to r40 are web results of every site the tests below name; r41 and r42 are the Maps listings 111 and 222.
const SITES = ['momohut.com.np', 'himal.com.np', 'shop.himal.com.np'];
const results = new Map<string, Result>(Array.from({ length: 40 }, (_, i) => [`r${i + 1}`, { url: `https://${SITES[i % 3]}/`, place: null }]));
results.set('r41', { url: null, place: { cid: '111' } });
results.set('r42', { url: null, place: { cid: '222' } });
const tidy = (raw: Business[], o: { ownSite?: string | null; skipKeys?: Set<string> } = {}) =>
  tidyBusinesses(raw, { ownSite: o.ownSite ?? null, skipKeys: o.skipKeys ?? new Set(), results });

describe('siteHost and linkKind', () => {
  it('reads the host of a full URL or a bare domain, and nothing that is not http(s)', () => {
    expect(siteHost('https://WWW.Himal.com.np./shop')).toBe('himal.com.np');
    expect(siteHost('himal.com.np')).toBe('himal.com.np');
    expect(siteHost('javascript:alert(1)')).toBeNull();
    expect(siteHost('mailto:a@himal.com.np')).toBeNull();
    expect(siteHost('Momo Hut')).toBeNull();
  });
  it('knows social and directory hosts, subdomains included', () => {
    expect(linkKind('https://m.facebook.com/momohut')).toBe('social');
    expect(linkKind('https://www.daraz.com.np/shop/momo')).toBe('directory');
    expect(linkKind('https://maps.google.com/?cid=1')).toBe('directory');
    expect(linkKind('https://momohut.com.np')).toBe('site');
    expect(linkKind('https://notfacebook.com')).toBe('site');
  });
});

describe('tidyBusinesses', () => {
  it('drops the brand own site even when the website was saved without a scheme', () => {
    expect(tidy([biz({ name: 'Himal', site: 'https://www.himal.com.np/shop' })], { ownSite: 'himal.com.np' }).kept).toEqual([]);
  });

  it('drops a subdomain of the own site', () => {
    expect(tidy([biz({ name: 'Himal shop', site: 'https://shop.himal.com.np' })], { ownSite: 'https://himal.com.np' }).kept).toEqual([]);
  });

  it('moves a Facebook site into channels and keys the business by name', () => {
    const [b] = tidy([biz({ name: 'Momo Hut', site: 'https://www.facebook.com/momohut' })]).kept;
    expect(b!.site).toBeNull();
    expect(b!.channels).toContain('https://www.facebook.com/momohut');
    expect(matchKey(b!)).toBe('name:momo hut');
  });

  it('nulls a directory site', () => {
    expect(tidy([biz({ name: 'Momo', site: 'https://www.daraz.com.np/shop/momo' })]).kept[0]!.site).toBeNull();
  });

  it('keeps a site and a channel only when they are http or https', () => {
    const [b] = tidy([biz({ name: 'Momo Hut', site: 'javascript:alert(1)', channels: ['javascript:alert(2)', 'https://instagram.com/momohut'] })]).kept;
    expect(b!.site).toBeNull();
    expect(b!.channels).toEqual(['https://instagram.com/momohut']);
  });

  it('merges two businesses with the same site host', () => {
    const { kept } = tidy([
      biz({ name: 'Momo Hut', site: 'https://momohut.com.np/', rank: 3, resultIds: ['r1'] }),
      biz({ name: 'Momo Hut Lalitpur', site: 'http://www.momohut.com.np/menu', rank: 1, resultIds: ['r4'] }),
    ]);
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ name: 'Momo Hut', rank: 1, resultIds: ['r1', 'r4'] });
  });

  it('keeps two same-named businesses with different Maps listing IDs apart', () => {
    const raw = [biz({ name: 'Momo House', placeCid: '111', resultIds: ['r41'] }), biz({ name: 'Momo House', placeCid: '222', resultIds: ['r42'], rank: 2 })];
    expect(tidy(raw).kept).toHaveLength(2);
  });

  it("keeps a site or a Maps listing ID only when one of the business's own results carries it", () => {
    const [b] = tidy([biz({ name: 'Evil Momo', site: 'https://real.example/', placeCid: '111', resultIds: ['r1'] })]).kept;
    expect(b).toMatchObject({ site: null, placeCid: null });
    // So it is neither skipped as the hidden business it names, nor merged into the real one.
    const r = tidy(
      [biz({ name: 'Evil Momo', site: 'https://real.example/', resultIds: ['r1'] }), biz({ name: 'Real Momo', placeCid: '111', resultIds: ['r41'] }), biz({ name: 'Evil Two', placeCid: '111', resultIds: ['r1'] })],
      { skipKeys: new Set(['site:real.example']) },
    );
    expect(r.skipped).toBe(0);
    expect(r.kept.map((x) => [x.name, x.site, x.placeCid])).toEqual([['Evil Momo', null, null], ['Real Momo', null, '111'], ['Evil Two', null, null]]);
    const [real] = tidy([biz({ name: 'Momo Hut', site: 'momohut.com.np', placeCid: '111', resultIds: ['r1', 'r41'] })]).kept;
    expect(real).toMatchObject({ site: 'https://momohut.com.np/', placeCid: '111' });
  });

  it('drops a business with no valid result id', () => {
    expect(tidy([biz({ name: 'Ghost', resultIds: ['r99'] })]).kept).toEqual([]);
  });

  it('skips businesses whose key is in skipKeys and counts them', () => {
    const r = tidy([biz({ name: 'Momo Hut', site: 'https://momohut.com.np' }), biz({ name: 'Other', rank: 2 })], { skipKeys: new Set(['site:momohut.com.np']) });
    expect(r.skipped).toBe(1);
    expect(r.kept.map((b) => b.name)).toEqual(['Other']);
  });

  it('keeps the 30 best ranked', () => {
    const raw = Array.from({ length: 35 }, (_, i) => biz({ name: `Shop ${i}`, rank: 35 - i }));
    const { kept } = tidy(raw);
    expect(kept.map((b) => b.rank)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
  });

  it('folds look-alike letters when keying by name, and keeps Devanagari vowel signs', () => {
    expect(matchKey({ site: null, name: 'Momo Нut' })).toBe(matchKey({ site: null, name: 'Momo Hut' }));
    expect(matchKey({ site: null, name: 'मोमो  घर!' })).toBe('name:मोमो घर');
  });
});
