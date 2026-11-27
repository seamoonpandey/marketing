import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDb, type TestDb } from '../../../test/helpers.ts';
import { createApp } from '../../app.ts';
import { withBrand } from '../../db/tenant.ts';
import { ensureBucket } from '../../storage/index.ts';
import { enterFact, proposeFacts } from './facts/index.ts';

let t: TestDb;
const app = createApp();

const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(`/api${path}`, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as any };
};
const denied = async (objectId: string) =>
  (await t.adminQuery(`select * from audit_events where result = 'denied' and object_id = $1`, [objectId])).length;

beforeAll(async () => {
  await ensureBucket();
  t = await testDb();
});
afterAll(() => t.close());

async function pageSource(brand: string, text: string): Promise<string> {
  const [row] = await t.adminQuery<{ id: string }>(
    `insert into sources (tenant_id, brand_id, kind, uri, mime, checksum, object_key, text, trust)
     values ($1, $2, 'page', 'https://tea.example/', 'text/html', 'x', 'k', $3, 'brand_site') returning id`,
    [t.tenantId, brand, text],
  );
  return row!.id;
}

describe('knowledge API', () => {
  it("AT-001: brand B's fact and import through brand A's path answer 404 and leave a denied event", async () => {
    const a = await t.makeBrand('A');
    const b = await t.makeBrand('B');
    const fact = await withBrand(b, (tx) =>
      enterFact(tx, b, { section: 'positioning', field: 'value_proposition', value: 'B only', language: 'en' }),
    );
    const [run] = await t.adminQuery<{ id: string }>(
      `insert into import_runs (tenant_id, brand_id, state) values ($1, $2, 'awaiting_approval') returning id`,
      [t.tenantId, b],
    );

    const attempts = [
      call('GET', `/brands/${a}/knowledge/facts/${fact.id}/history`),
      call('POST', `/brands/${a}/knowledge/facts/${fact.id}/approve`),
      call('PATCH', `/brands/${a}/knowledge/facts/${fact.id}`, { value: 'taken over' }),
      call('POST', `/brands/${a}/knowledge/facts/${fact.id}/reject`),
      call('POST', `/brands/${a}/knowledge/conflicts/resolve`, { keepFactId: fact.id }),
    ];
    for (const r of await Promise.all(attempts)) {
      expect(r.status).toBe(404);
      expect(r.body.error.code).toBe('not_found');
    }
    expect(await denied(fact.id)).toBe(5);
    expect((await call('GET', `/brands/${a}/knowledge/imports/${run!.id}`)).status).toBe(404);
    expect((await call('POST', `/brands/${a}/knowledge/imports/${run!.id}/cancel`)).status).toBe(404);
    expect(await denied(run!.id)).toBe(2);

    expect((await call('GET', `/brands/${a}/knowledge/facts`)).body.items).toEqual([]);
    const history = await call('GET', `/brands/${b}/knowledge/facts/${fact.id}/history`);
    expect(history.body.map((f: any) => [f.version, f.value])).toEqual([[1, 'B only']]);
  });

  it('approve-batch refuses a batch holding a conflicting fact and approves none of it', async () => {
    const brand = await t.makeBrand();
    const s = await pageSource(brand, 'Green tea costs NPR 4500. Green tea costs NPR 5000. We were founded in Ilam in 2009.');
    await withBrand(brand, (tx) =>
      proposeFacts(tx, brand, randomUUID(), [
        { section: 'products', subjectName: 'Green tea', field: 'price', value: 4500, unit: 'NPR', language: 'en', origin: 'stated', sourceId: s, quote: 'Green tea costs NPR 4500', confidence: 0.9 },
        { section: 'products', subjectName: 'Green tea', field: 'price', value: 5000, unit: 'NPR', language: 'en', origin: 'stated', sourceId: s, quote: 'Green tea costs NPR 5000', confidence: 0.9 },
        { section: 'identity', field: 'country', value: 'Nepal', language: 'en', origin: 'stated', sourceId: s, quote: 'We were founded in Ilam in 2009', confidence: 0.6 },
      ], [s]),
    );
    const { items } = (await call('GET', `/brands/${brand}/knowledge/facts`)).body;
    const unverified = items.find((f: any) => f.status === 'unverified');
    const conflicting = items.find((f: any) => f.status === 'conflicting');

    const r = await call('POST', `/brands/${brand}/knowledge/facts/approve-batch`, { ids: [unverified.id, conflicting.id] });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('conflict');
    const after = (await call('GET', `/brands/${brand}/knowledge/facts?status=approved`)).body.items;
    expect(after).toEqual([]);

    const ok = await call('POST', `/brands/${brand}/knowledge/facts/approve-batch`, { ids: [unverified.id] });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual([expect.objectContaining({ status: 'approved', value: 'Nepal', version: 2 })]);
  });

  it('answers 400 with the shared error body for every invalid request', async () => {
    const brand = await t.makeBrand();
    const id = randomUUID();
    const P = `/brands/${brand}/knowledge`;
    const bad: [string, string, unknown][] = [
      ['POST', `${P}/imports`, { websiteUrl: 'ftp://tea.example/' }],
      ['POST', `${P}/imports`, {}],
      ['POST', `${P}/facts`, { section: 'nope', field: 'x', value: 'y', language: 'en' }],
      ['POST', `${P}/facts`, { section: 'identity', field: 'favourite_colour', value: 'teal', language: 'en' }],
      ['POST', `${P}/facts`, { section: 'voice', field: 'emoji', value: 'lots', language: 'en' }],
      ['POST', `${P}/facts`, { section: 'products', field: 'price', value: 4500, language: 'en' }],
      ['PATCH', `${P}/facts/${id}`, {}],
      ['POST', `${P}/facts/${id}/reject`, { reason: 5 }],
      ['POST', `${P}/facts/approve-batch`, { ids: [] }],
      ['POST', `${P}/conflicts/resolve`, {}],
      ['POST', `${P}/subjects`, { type: 'person', name: 'Sita' }],
      ['POST', `${P}/assets`, { kind: 'logo' }],
      ['PATCH', `${P}/assets/${id}`, { kind: 'banner' }],
      ['PUT', `${P}/palette`, { colours: [{ hex: 'teal', role: null }] }],
      ['PUT', `${P}/palette`, { colours: [{ hex: '#0f5257', role: 'primary' }, { hex: '#0F5257', role: null }] }],
      ['GET', `${P}/facts?limit=0`, undefined],
      ['GET', `${P}/facts?status=lost`, undefined],
      ['GET', `${P}/subjects?type=person`, undefined],
    ];
    for (const [method, path, body] of bad) {
      const r = await call(method, path, body);
      expect([method, path, r.status]).toEqual([method, path, 400]);
      expect(r.body).toEqual({ error: { code: 'validation', message: expect.any(String) } });
    }
  });

  it('serves the catalogue, subjects, facts, palette, readiness and book', async () => {
    const brand = await t.makeBrand();
    const P = `/brands/${brand}/knowledge`;
    expect((await call('GET', `${P}/catalogue`)).body).toHaveLength(9);

    const tea = await call('POST', `${P}/subjects`, { type: 'product', name: 'Green tea' });
    expect(tea.status).toBe(201);
    expect((await call('POST', `${P}/subjects`, { type: 'product', name: ' green TEA ' })).body.id).toBe(tea.body.id);
    expect((await call('GET', `${P}/subjects?type=product`)).body).toHaveLength(1);

    const price = await call('POST', `${P}/facts`, {
      section: 'products', subjectId: tea.body.id, field: 'price', value: 4500, unit: 'NPR', language: 'en', expiresAt: '2027-03-31T00:00:00Z',
    });
    expect(price.status).toBe(201);
    expect(price.body).toMatchObject({ status: 'approved', origin: 'owner', subjectName: 'Green tea', fieldLabel: 'Price', expiresAt: '2027-03-31T00:00:00.000Z' });
    const rejected = await call('POST', `${P}/facts/${price.body.id}/reject`);
    expect(rejected.body).toMatchObject({ status: 'rejected', version: 2 });
    expect((await call('POST', `${P}/facts/${price.body.id}/approve`)).status).toBe(409); // an older version

    const palette = await call('PUT', `${P}/palette`, { colours: [{ hex: '#141414', role: 'text' }, { hex: '#C3D7E5', role: 'background' }] });
    expect(palette.body.contrasts).toEqual([{ text: '#141414', background: '#c3d7e5', ratio: expect.any(Number), aa: true, aaLarge: true }]);
    expect(palette.body.colours[0]).toMatchObject({ origin: 'owner', rgb: expect.any(Object), cmyk: expect.any(Object) });

    expect((await call('GET', `${P}/readiness`)).body).toMatchObject({ score: expect.any(Number), band: 'blocked' });
    const book = await call('GET', `${P}/book`);
    expect(book.status).toBe(200);
    expect(book.body.sections).toHaveLength(9);
    expect((await call('GET', `${P}/imports`)).body).toEqual([]);
  });
});
