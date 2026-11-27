import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDb, type TestDb } from '../../../../test/helpers.ts';
import { withBrand } from '../../../db/tenant.ts';
import { ConflictError } from '../../../http/errors.ts';
import {
  approvedFacts, approveFact, editFact, enterFact, factHistory, findOrCreateSubject, listFacts, proposeFacts, rejectFact,
  resolveConflict, type ProposedFact,
} from './index.ts';

let t: TestDb;
beforeAll(async () => {
  t = await testDb();
});
afterAll(() => t.close());

/** A page source with this text, inserted directly. */
async function source(brand: string, text: string): Promise<string> {
  const [row] = await t.adminQuery<{ id: string }>(
    `insert into sources (tenant_id, brand_id, kind, uri, mime, checksum, object_key, text, trust)
     values ($1, $2, 'page', 'https://tea.example/', 'text/html', 'x', 'k', $3, 'brand_site') returning id`,
    [t.tenantId, brand, text],
  );
  return row!.id;
}

const price = (sourceId: string, value: unknown, quote: string): ProposedFact => ({
  section: 'products', subjectName: 'Green tea 250 g', field: 'price', value, unit: 'NPR', language: 'en',
  origin: 'stated', sourceId, quote, confidence: 0.9,
});

/** As an import whose batch read every source these items cite. */
const propose = (brand: string, items: ProposedFact[]) =>
  withBrand(brand, (tx) => proposeFacts(tx, brand, randomUUID(), items, items.flatMap((i) => (i.sourceId ? [i.sourceId] : []))));
const list = (brand: string, f: Parameters<typeof listFacts>[2] = {}) => withBrand(brand, (tx) => listFacts(tx, brand, f));
const approved = (brand: string) => withBrand(brand, (tx) => approvedFacts(tx, brand));

describe('facts', () => {
  it('AT-003: two prices for one product conflict until the owner keeps one', async () => {
    const brand = await t.makeBrand();
    const a = await source(brand, 'Green tea 250 g costs NPR 4500 at our shop.');
    const b = await source(brand, 'Price list: Green tea 250 g, NPR 5000 per tin.');
    const counts = await propose(brand, [
      price(a, 4500, 'Green tea 250 g costs NPR 4500'),
      price(b, 5000, 'Green tea 250 g, NPR 5000 per tin'),
    ]);
    expect(counts).toMatchObject({ unverified: 1, conflicts: 1, inferred: 0, dropped: 0 });

    const conflicting = (await list(brand, { status: 'conflicting' })).items;
    expect(conflicting.map((f) => f.value).sort()).toEqual([4500, 5000]);
    expect(conflicting.every((f) => f.subjectName === 'Green tea 250 g' && f.quote && f.source)).toBe(true);
    expect(await approved(brand)).toEqual([]);

    const keep = conflicting.find((f) => f.value === 4500)!;
    const kept = await withBrand(brand, (tx) => resolveConflict(tx, brand, { keepFactId: keep.id }));
    expect(kept).toMatchObject({ status: 'approved', value: 4500, verifiedBy: 'operator' });
    const current = (await list(brand)).items;
    expect(current.map((f) => [f.value, f.status]).sort()).toEqual([[4500, 'approved'], [5000, 'rejected']]);
    expect((await approved(brand)).map((f) => f.value)).toEqual([4500]);
  });

  it('stores a stated fact whose quote is not in its source as inferred, with the warning and no source', async () => {
    const brand = await t.makeBrand();
    const s = await source(brand, 'We sell green tea from Ilam.');
    const counts = await propose(brand, [
      { section: 'identity', field: 'legal_name', value: 'Himal Tea Pvt Ltd', language: 'en', origin: 'stated', sourceId: s, quote: 'Himal Tea Private Limited', confidence: 0.8 },
    ]);
    expect(counts).toMatchObject({ inferred: 1, unverified: 0 });
    const [fact] = (await list(brand)).items;
    expect(fact).toMatchObject({ status: 'inferred', warning: 'quote not found in source', source: null, quote: null });
  });

  it('drops a field outside the catalogue, an invalid value and a product with no name', async () => {
    const brand = await t.makeBrand();
    const counts = await propose(brand, [
      { section: 'identity', field: 'favourite_colour', value: 'teal', language: 'en', origin: 'inferred', confidence: 0.5 },
      { section: 'voice', field: 'emoji', value: 'lots', language: 'en', origin: 'inferred', confidence: 0.5 },
      { section: 'products', field: 'name', value: 'Tea', language: 'en', origin: 'inferred', confidence: 0.5 },
    ]);
    expect(counts.dropped).toBe(3);
    expect((await list(brand)).items).toEqual([]);
  });

  it('editFact on an approved fact adds version 2, approved, origin owner, and history shows both', async () => {
    const brand = await t.makeBrand();
    const first = await withBrand(brand, (tx) =>
      enterFact(tx, brand, { section: 'positioning', field: 'value_proposition', value: 'Fresh tea', language: 'en' }),
    );
    expect(first).toMatchObject({ status: 'approved', origin: 'owner', version: 1 });
    const second = await withBrand(brand, (tx) => editFact(tx, brand, first.id, { value: 'Fresh tea, hand-rolled in Ilam' }));
    expect(second).toMatchObject({ status: 'approved', origin: 'owner', version: 2, supersedesId: first.id, isCurrent: true });
    for (const id of [first.id, second.id]) {
      const history = await withBrand(brand, (tx) => factHistory(tx, brand, id));
      expect(history.map((f) => [f.version, f.value, f.isCurrent])).toEqual([
        [1, 'Fresh tea', false],
        [2, 'Fresh tea, hand-rolled in Ilam', true],
      ]);
    }
    // The older version can no longer be acted on.
    await expect(withBrand(brand, (tx) => approveFact(tx, brand, first.id))).rejects.toBeInstanceOf(ConflictError);
  });

  it('lists an approved fact past its expiry as expired and leaves it out of approvedFacts', async () => {
    const brand = await t.makeBrand();
    const product = await withBrand(brand, (tx) => findOrCreateSubject(tx, brand, 'product', 'Green tea'));
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    await withBrand(brand, (tx) =>
      enterFact(tx, brand, { section: 'products', subjectId: product.id, field: 'price', value: 4500, unit: 'NPR', language: 'en', expiresAt: yesterday }),
    );
    expect((await list(brand)).items[0]!.status).toBe('expired');
    expect((await list(brand, { status: 'expired' })).items).toHaveLength(1);
    expect((await list(brand, { status: 'approved' })).items).toHaveLength(0);
    expect(await approved(brand)).toEqual([]);
  });

  it('review focus 2: the same value proposed twice leaves one row and counts unchanged', async () => {
    const brand = await t.makeBrand();
    const s = await source(brand, 'Green tea 250 g costs NPR 4500 at our shop.');
    await propose(brand, [price(s, 4500, 'Green tea 250 g costs NPR 4500')]);
    const again = await propose(brand, [price(s, '4500', 'Green tea 250 g costs NPR 4500')]);
    expect(again).toMatchObject({ unchanged: 1, conflicts: 0, unverified: 0 });
    expect(await t.adminQuery(`select id from facts where brand_id = $1`, [brand])).toHaveLength(1);
  });

  it("review focus 3: a different value proposed after the owner's entry leaves the owner's value and marks both conflicting", async () => {
    const brand = await t.makeBrand();
    const owner = await withBrand(brand, (tx) =>
      enterFact(tx, brand, { section: 'legal', field: 'refund', value: 'Refunds within 7 days', language: 'en' }),
    );
    const s = await source(brand, 'Refunds within 30 days of purchase.');
    const counts = await propose(brand, [
      { section: 'legal', field: 'refund', value: 'Refunds within 30 days', language: 'en', origin: 'stated', sourceId: s, quote: 'Refunds within 30 days of purchase', confidence: 0.9 },
    ]);
    expect(counts.conflicts).toBe(1);
    const current = (await list(brand, { section: 'legal' })).items;
    expect(current.map((f) => [f.value, f.origin, f.status]).sort()).toEqual([
      ['Refunds within 30 days', 'stated', 'conflicting'],
      ['Refunds within 7 days', 'owner', 'conflicting'],
    ]);
    // The owner's fact is a new version of the same lineage, not overwritten.
    const ownerNow = current.find((f) => f.origin === 'owner')!;
    expect(ownerNow.supersedesId).toBe(owner.id);
    await expect(withBrand(brand, (tx) => rejectFact(tx, brand, ownerNow.id))).rejects.toBeInstanceOf(ConflictError);

    const typed = await withBrand(brand, (tx) =>
      resolveConflict(tx, brand, { section: 'legal', field: 'refund', value: 'Refunds within 14 days', language: 'en' }),
    );
    expect(typed).toMatchObject({ status: 'approved', origin: 'owner' });
    expect((await approved(brand)).map((f) => f.value)).toEqual(['Refunds within 14 days']);
  });

  it('keeps a Nepali price as text with its quote', async () => {
    const brand = await t.makeBrand();
    const s = await source(brand, 'हरियो चिया २५० ग्राम: रु ४,५०० मात्र');
    await propose(brand, [{ ...price(s, 'रु ४,५००', 'हरियो चिया २५० ग्राम: रु ४,५००'), language: 'ne' }]);
    const [fact] = (await list(brand)).items;
    expect(fact).toMatchObject({ value: 'रु ४,५००', status: 'unverified', quote: 'हरियो चिया २५० ग्राम: रु ४,५००' });
  });
});
