import { randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDb, type TestDb } from '../../../../test/helpers.ts';
import { withBrand } from '../../../db/tenant.ts';
import { ConflictError, NotFoundError, ValidationError } from '../../../http/errors.ts';
import { createCompetitor, listCompetitors } from '../../brands/index.ts';
import { fetchGuard } from '../../sources/fetch.ts';
import { addTarget, listTargets } from '../targets.ts';
import { dismissCandidate, listCandidates, restoreCandidate, watchCandidates } from './candidates.ts';

/** Pages the local server answers, by host and path ("rival.example/"). Every host resolves to it. */
const pages: Record<string, string> = {
  'rival.example/': '<title>Rival Momo</title><p>Momo in Patan</p><a href="/pricing">Prices</a>',
  'rival.example/pricing': '<title>Prices</title><p>Buff momo Rs 180</p>',
  'other.example/': '<title>Other Momo</title><p>Momo in Thamel</p>',
};
let server: http.Server;
let port: number;
let t: TestDb;
const saved = { ...fetchGuard };

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const body = pages[`${(req.headers.host ?? '').split(':')[0]}${req.url}`];
    if (body === undefined) return void res.writeHead(404).end('missing');
    res.writeHead(200, { 'content-type': 'text/html' }).end(body);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
  fetchGuard.resolve = async () => [{ address: '127.0.0.1', family: 4 }];
  fetchGuard.isBlocked = () => false;
  fetchGuard.minIntervalMs = 0;
  t = await testDb();
});
afterAll(async () => {
  Object.assign(fetchGuard, saved);
  await t.close();
  server.close();
});

const site = (host: string) => `http://${host}:${port}/`;
const KIND = { value: 'indirect', basis: 'inferred', reason: 'Sells frozen momo, not meals.', evidence: ['x'], confidence: 'medium' };

async function candidate(brand: string, c: { name: string; site?: string | null; channels?: string[]; cells?: object }): Promise<string> {
  const [row] = await t.adminQuery(
    `insert into discovery_candidates (tenant_id, brand_id, match_key, name, site, channels, cells, rank, first_run_id, last_run_id)
     values ($1, $2, $3, $4, $5, $6, $7, 1, $8, $8) returning id`,
    [t.tenantId, brand, `name:${c.name}`, c.name, c.site ?? null, JSON.stringify(c.channels ?? []), JSON.stringify(c.cells ?? {}), randomUUID()],
  );
  return row.id;
}
/** A brand whose `n` competitors each have a watched page. */
async function watching(n: number): Promise<string> {
  const brand = await t.makeBrand();
  await withBrand(brand, async (tx) => {
    for (let i = 0; i < n; i++) {
      const c = await createCompetitor(tx, brand, { name: `Rival ${i}` });
      await addTarget(tx, brand, { competitorId: c.id, url: `https://rival${i}.example/` });
    }
  });
  return brand;
}
const status = async (id: string) => (await t.adminQuery(`select status from discovery_candidates where id = $1`, [id]))[0].status;
const competitors = (brand: string) => withBrand(brand, (tx) => listCompetitors(tx, brand));

describe('candidates', () => {
  it('watching a business with a site creates the competitor with its handles and adds its suggested pages', async () => {
    const brand = await t.makeBrand();
    const id = await candidate(brand, {
      name: 'Rival Momo', site: site('rival.example'), cells: { kind: KIND },
      channels: ['https://www.facebook.com/rivalmomo', 'https://www.google.com/maps?cid=42', 'https://instagram.com/rivalmomo'],
    });
    const { watched, unreadable } = await watchCandidates(brand, [id]);
    expect(unreadable).toEqual([]);
    expect(watched).toMatchObject([{ id, status: 'watched' }]);
    const [competitor] = await competitors(brand);
    expect(competitor).toMatchObject({
      id: watched[0]!.competitorId, name: 'Rival Momo', kind: 'indirect', site: site('rival.example'),
      handles: { facebook: 'https://www.facebook.com/rivalmomo', instagram: 'https://instagram.com/rivalmomo' },
    });
    const targets = await withBrand(brand, (tx) => listTargets(tx, brand, competitor!.id));
    expect(targets.map((x) => x.url)).toEqual([site('rival.example'), `${site('rival.example')}pricing`]);
    expect(await t.adminQuery(`select 1 from audit_events where action = 'research.candidate.watch' and object_id = $1`, [id])).toHaveLength(1);
  });

  it('refuses a whole request that would exceed the free watch slots and creates nothing', async () => {
    const brand = await watching(9);
    const a = await candidate(brand, { name: 'Rival Momo', site: site('rival.example') });
    const b = await candidate(brand, { name: 'Other Momo', site: site('other.example') });
    await expect(watchCandidates(brand, [a, b])).rejects.toThrow(new ValidationError('You can watch 1 more competitors with a website; untick some'));
    expect(await competitors(brand)).toHaveLength(9);
    expect([await status(a), await status(b)]).toEqual(['new', 'new']);
  });

  it('gives the last free watch slot to one of several simultaneous requests and refuses the others', async () => {
    const brand = await watching(9);
    const hosts = ['twin1.example', 'twin2.example', 'twin3.example'];
    for (const h of hosts) Object.assign(pages, { [`${h}/`]: pages['rival.example/'], [`${h}/pricing`]: pages['rival.example/pricing'] });
    const ids = await Promise.all(hosts.map((h) => candidate(brand, { name: h, site: site(h) })));
    const settled = await Promise.allSettled(ids.map((id) => watchCandidates(brand, [id])));
    expect(settled.map((s) => s.status).sort()).toEqual(['fulfilled', 'rejected', 'rejected']);
    for (const s of settled) if (s.status === 'rejected') expect(s.reason).toBeInstanceOf(ValidationError);
    // No competitor was created without the pages its readable site gave.
    const all = await competitors(brand);
    expect(all).toHaveLength(10);
    const targets = await withBrand(brand, (tx) => listTargets(tx, brand));
    expect(all.every((c) => targets.some((x) => x.competitorId === c.id))).toBe(true);
  });

  it('makes one competitor when the same candidate is watched by simultaneous requests', async () => {
    const brand = await t.makeBrand();
    const id = await candidate(brand, { name: 'Rival Momo', site: site('rival.example') });
    const settled = await Promise.allSettled([1, 2, 3].map(() => watchCandidates(brand, [id])));
    expect(settled.map((s) => s.status).sort()).toEqual(['fulfilled', 'rejected', 'rejected']);
    for (const s of settled) if (s.status === 'rejected') expect(s.reason).toBeInstanceOf(ConflictError);
    expect(await competitors(brand)).toHaveLength(1);
    expect(await withBrand(brand, (tx) => listTargets(tx, brand))).toHaveLength(2);
  });

  it('adds a business with no site with no pages and takes no slot', async () => {
    const brand = await watching(10);
    const id = await candidate(brand, { name: 'Momo Cart', channels: ['https://www.facebook.com/momocart'] });
    const { watched, unreadable } = await watchCandidates(brand, [id]);
    expect(unreadable).toEqual([]);
    expect(watched[0]!.status).toBe('watched');
    expect((await competitors(brand)).find((c) => c.id === watched[0]!.competitorId)).toMatchObject({
      name: 'Momo Cart', kind: 'direct', site: null, handles: { facebook: 'https://www.facebook.com/momocart' },
    });
    expect(await withBrand(brand, (tx) => listTargets(tx, brand, watched[0]!.competitorId!))).toEqual([]);
  });

  it('reports a site it could not read and still creates the competitor', async () => {
    const brand = await t.makeBrand();
    const id = await candidate(brand, { name: 'Gone Momo', site: site('gone.example') });
    const { watched, unreadable } = await watchCandidates(brand, [id]);
    expect(unreadable).toEqual([id]);
    expect(await competitors(brand)).toMatchObject([{ name: 'Gone Momo', site: site('gone.example') }]);
    expect(await withBrand(brand, (tx) => listTargets(tx, brand, watched[0]!.competitorId!))).toEqual([]);
  });

  it('refuses to watch a candidate twice (409), and another brand’s or a malformed id (404)', async () => {
    const brand = await t.makeBrand();
    const id = await candidate(brand, { name: 'Momo Cart' });
    await watchCandidates(brand, [id]);
    await expect(watchCandidates(brand, [id])).rejects.toThrow(ConflictError);
    const other = await t.makeBrand();
    const theirs = await candidate(other, { name: 'Their Momo' });
    await expect(watchCandidates(brand, [theirs])).rejects.toThrow(NotFoundError);
    await expect(watchCandidates(brand, ['not-an-id'])).rejects.toThrow(NotFoundError);
    await expect(withBrand(brand, (tx) => dismissCandidate(tx, brand, theirs))).rejects.toThrow(NotFoundError);
    expect(await status(theirs)).toBe('new');
    expect(await competitors(brand)).toHaveLength(1);
  });

  it('hides a candidate and restores it with its cells', async () => {
    const brand = await t.makeBrand();
    const id = await candidate(brand, { name: 'Momo Cart', cells: { kind: KIND } });
    const hidden = await withBrand(brand, (tx) => dismissCandidate(tx, brand, id));
    expect(hidden).toMatchObject({ status: 'dismissed' });
    expect(hidden.dismissedAt).toBeInstanceOf(Date);
    expect(await withBrand(brand, (tx) => listCandidates(tx, brand))).toEqual([]);
    expect((await withBrand(brand, (tx) => listCandidates(tx, brand, 'dismissed'))).map((c) => c.id)).toEqual([id]);
    await expect(withBrand(brand, (tx) => dismissCandidate(tx, brand, id))).rejects.toThrow(ConflictError);

    const back = await withBrand(brand, (tx) => restoreCandidate(tx, brand, id));
    expect(back).toMatchObject({ status: 'new', dismissedAt: null, cells: { kind: KIND }, lastFoundAt: hidden.lastFoundAt });
    expect((await withBrand(brand, (tx) => listCandidates(tx, brand))).map((c) => c.id)).toEqual([id]);
    await expect(withBrand(brand, (tx) => restoreCandidate(tx, brand, id))).rejects.toThrow(ConflictError);
  });
});
