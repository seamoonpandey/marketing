import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDb, type TestDb } from '../../../test/helpers.ts';
import { withBrand } from '../../db/tenant.ts';
import { createCompetitor } from '../brands/index.ts';
import { createAsset } from './assets.ts';
import { brandBook } from './book.ts';
import { enterFact, findOrCreateSubject, proposeFacts } from './facts/index.ts';
import { setPalette } from './palette/index.ts';
import { readiness } from './readiness.ts';

let t: TestDb;
beforeAll(async () => {
  t = await testDb();
});
afterAll(() => t.close());

const score = (brand: string) => withBrand(brand, (tx) => readiness(tx, brand));

/** A completed upload, inserted directly (readiness needs the row, not the file). */
async function uploadRow(brand: string, filename: string): Promise<string> {
  const [row] = await t.adminQuery<{ id: string }>(
    `insert into sources (tenant_id, brand_id, kind, uri, mime, checksum, object_key, trust, meta)
     values ($1, $2, 'upload', 'upload:x', 'image/png', 'x', 'tenant/x/brand/x/upload/x.png', 'owner', $3) returning id`,
    [t.tenantId, brand, JSON.stringify({ filename, status: 'ready' })],
  );
  return row!.id;
}

/** Everything the six dimensions of this sprint ask for, approved by the owner. */
async function completeBrand(brand: string) {
  await withBrand(brand, async (tx) => {
    const tea = await findOrCreateSubject(tx, brand, 'product', 'Ilam Green Tea 250 g');
    const segment = await findOrCreateSubject(tx, brand, 'segment', 'Kathmandu tea lovers');
    const enter = (section: string, field: string, value: unknown, subjectId?: string, unit?: string) =>
      enterFact(tx, brand, { section, field, value, subjectId, unit, language: 'en' });
    await enter('products', 'name', 'Ilam Green Tea 250 g', tea.id);
    await enter('products', 'description', 'A light first-flush green tea in a 250 g tin.', tea.id);
    await enter('products', 'price', 4500, tea.id, 'NPR');
    await enter('audience', 'problem', 'Cannot find fresh local green tea.', segment.id);
    await enter('audience', 'desired_outcome', 'A fresh tin delivered each month.', segment.id);
    await enter('positioning', 'value_proposition', 'Hand-rolled the day it is picked.');
    await enter('positioning', 'differentiators', 'Rolled the same day');
    await enter('positioning', 'prohibited_claims', ['cures illness']);
    await enter('voice', 'traits', ['warm', 'plain']);
    await enter('legal', 'refund', 'Unopened tins within 14 days.');
    await enter('legal', 'privacy_url', 'https://ilamleaf.example/privacy');
    await enter('goals', 'primary_objective', 'More repeat orders');
    await enter('goals', 'max_ai_spend', 2000, undefined, 'NPR');
    await enter('goals', 'approvers', ['Sita Rai']);
    await createAsset(tx, brand, { sourceId: await uploadRow(brand, 'logo.png'), kind: 'logo', rights: { licence: 'Owned by the brand' } });
    await setPalette(tx, brand, [
      { hex: '#0f5257', role: 'primary' }, { hex: '#141414', role: 'text' }, { hex: '#f5efe5', role: 'background' },
    ]);
    for (const name of ['Rival A', 'Rival B', 'Rival C'])
      await createCompetitor(tx, brand, { name, site: `https://${name.replace(' ', '').toLowerCase()}.example` });
  });
}

describe('readiness', () => {
  it('scores a new brand 0, blocked, with every criterion failing', async () => {
    const r = await score(await t.makeBrand());
    expect(r).toMatchObject({ score: 0, band: 'blocked', gates: [] });
    expect(r.dimensions.flatMap((d) => d.criteria).every((c) => !c.pass)).toBe(true);
    expect(r.dimensions.map((d) => d.weight).reduce((a, b) => a + b)).toBe(100);
  });

  it('scores nothing for product facts the owner has not approved', async () => {
    const brand = await t.makeBrand();
    await withBrand(brand, (tx) =>
      proposeFacts(tx, brand, randomUUID(), [
        { section: 'products', subjectName: 'Ilam Green Tea 250 g', field: 'name', value: 'Ilam Green Tea', language: 'en', origin: 'inferred', confidence: 0.5 },
      ]),
    );
    const r = await score(brand);
    expect(r.dimensions.flatMap((d) => d.criteria).filter((c) => c.pass)).toEqual([]);
    expect(r.score).toBe(0);
  });

  it('scores the complete fixture brand 70, limited_pilot, with three dimensions set up later', async () => {
    const brand = await t.makeBrand();
    await completeBrand(brand);
    const r = await score(brand);
    expect(r.dimensions.flatMap((d) => d.criteria).filter((c) => !c.pass)).toEqual([]);
    expect(r).toMatchObject({ score: 70, band: 'limited_pilot', gates: [] });
    expect(r.dimensions.filter((d) => d.note).map((d) => [d.key, d.earned, d.note])).toEqual([
      ['channels', 0, 'Set up with Publish'],
      ['website_analytics', 0, 'Set up with Results'],
      ['crm', 0, 'Set up with Leads'],
    ]);

    const book = await withBrand(brand, (tx) => brandBook(tx, brand));
    expect(book.sections.map((s) => s.key)).toHaveLength(9);
    expect(book.sections.find((s) => s.key === 'products')!.facts).toHaveLength(3);
    expect(book.palette.contrasts).toEqual([expect.objectContaining({ text: '#141414', background: '#f5efe5', aa: true })]);
    expect(book.assets).toHaveLength(1);
    expect(book.competitors).toHaveLength(3);
    expect(book.readiness.score).toBe(70);
  });

  it('gates an unresolved price conflict and an unlicensed asset, with fix paths', async () => {
    const brand = await t.makeBrand();
    await completeBrand(brand);
    const [s] = await t.adminQuery<{ id: string }>(
      `insert into sources (tenant_id, brand_id, kind, uri, mime, checksum, object_key, text, trust)
       values ($1, $2, 'page', 'https://ilamleaf.example/', 'text/html', 'x', 'k', 'Ilam Green Tea 250 g: NPR 5000 per tin', 'brand_site') returning id`,
      [t.tenantId, brand],
    );
    await withBrand(brand, (tx) =>
      proposeFacts(tx, brand, randomUUID(), [
        { section: 'products', subjectName: 'Ilam Green Tea 250 g', field: 'price', value: 5000, unit: 'NPR', language: 'en', origin: 'stated', sourceId: s!.id, quote: 'Ilam Green Tea 250 g: NPR 5000 per tin', confidence: 0.9 },
      ]),
    );
    await withBrand(brand, async (tx) => createAsset(tx, brand, { sourceId: await uploadRow(brand, 'hero.jpg'), kind: 'photo' }));
    const r = await score(brand);
    expect(r.band).toBe('blocked');
    expect(r.gates).toEqual([
      { label: 'Resolve the conflicting price of Ilam Green Tea 250 g', fixPath: `/app/b/${brand}/brand/review?section=products&status=conflicting` },
      { label: 'Add the licence of hero.jpg', fixPath: `/app/b/${brand}/brand/sources` },
    ]);
    expect(r.score).toBeLessThan(70); // the price is no longer approved and an asset lacks a licence
  });
});
