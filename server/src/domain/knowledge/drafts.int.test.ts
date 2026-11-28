import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { testDb, type TestDb } from '../../../test/helpers.ts';
import { mockAi } from '../../ai/index.ts';
import { createApp } from '../../app.ts';
import { withBrand } from '../../db/tenant.ts';
import { CATALOGUE } from './catalogue.ts';
import { enterFact } from './facts/index.ts';

let t: TestDb;
const app = createApp();
const draft = async (brand: string, section: string, field: string) => {
  const res = await app.request(`/api/brands/${brand}/knowledge/drafts`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ section, field }),
  });
  return { status: res.status, body: (await res.json()) as any };
};
const page = (brand: string, uri: string, text: string) =>
  t.adminQuery(
    `insert into sources (tenant_id, brand_id, kind, uri, mime, checksum, object_key, text, trust)
     values ($1, $2, 'page', $3, 'text/html', 'x', 'k', $4, 'brand_site')`,
    [t.tenantId, brand, uri, text],
  );

beforeAll(async () => {
  t = await testDb();
});
afterAll(() => t.close());
afterEach(() => mockAi.reset());

describe('field drafts', () => {
  it('drafts from approved facts and the website text, records the cost and saves nothing', async () => {
    const brand = await t.makeBrand();
    await withBrand(brand, (tx) => enterFact(tx, brand, { section: 'identity', field: 'trading_name', value: 'Dhaka House', language: 'en' }));
    await page(brand, 'https://dhaka.example/', 'Hand-woven dhaka cloth from Palpa, sold since 1990.');
    mockAi.queue({ values: [' Dhaka cloth woven by hand in Palpa​, the way it has been since 1990. ', 'A second one'] });

    const r = await draft(brand, 'positioning', 'value_proposition');
    expect(r.status).toBe(200);
    expect(r.body.values).toEqual(['Dhaka cloth woven by hand in Palpa, the way it has been since 1990.']); // one value for a single field
    const sent = JSON.stringify(mockAi.calls[0]!.parts);
    expect(sent).toContain('Dhaka House');
    expect(sent).toContain('sold since 1990');
    expect(sent).not.toContain('Ilam'); // the catalogue's examples never reach the model
    expect(await t.adminQuery(`select 1 from cost_events where brand_id = $1 and run_type = 'knowledge_draft'`, [brand])).toHaveLength(1);
    expect(await t.adminQuery(`select 1 from facts where brand_id = $1 and field = 'value_proposition'`, [brand])).toHaveLength(0);
  });

  it('keeps every value of a list field, and calls no model when there is nothing to draft from', async () => {
    const brand = await t.makeBrand();
    expect((await draft(brand, 'voice', 'traits')).body).toEqual({ values: [], cost: { usd: '0.0000', npr: '0.00' } });
    expect(mockAi.calls).toHaveLength(0);

    await page(brand, 'https://dhaka.example/', 'We weave dhaka by hand.');
    mockAi.queue({ values: ['Warm', 'Proud'] });
    expect((await draft(brand, 'voice', 'traits')).body.values).toEqual(['Warm', 'Proud']);
  });

  it('refuses a field that cannot be drafted, and a brand of another tenant', async () => {
    const brand = await t.makeBrand();
    expect((await draft(brand, 'products', 'price')).status).toBe(400);
    expect((await draft('00000000-0000-4000-8000-000000000000', 'voice', 'traits')).status).toBe(404);
    expect(mockAi.calls).toHaveLength(0);
  });

  it('tells the web which fields can be drafted, never the instruction to the model', async () => {
    const brand = await t.makeBrand();
    const res = await app.request(`/api/brands/${brand}/knowledge/catalogue`);
    const fields = ((await res.json()) as { fields: Record<string, unknown>[] }[]).flatMap((s) => s.fields);
    expect(fields.filter((f) => f.draftable).map((f) => f.key)).toEqual(['value_proposition', 'differentiators', 'prohibited_claims', 'traits', 'refund']);
    expect(fields.some((f) => 'draft' in f)).toBe(false);
    expect(CATALOGUE.flatMap((s) => s.fields).filter((f) => f.draft).every((f) => f.question && f.why)).toBe(true);
  });
});
