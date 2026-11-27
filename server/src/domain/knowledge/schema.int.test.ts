import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDb, type TestDb } from '../../../test/helpers.ts';
import { facts } from '../../db/schema/index.ts';
import { withBrand } from '../../db/tenant.ts';

let t: TestDb;
beforeAll(async () => {
  t = await testDb();
});
afterAll(() => t.close());

describe('knowledge schema', () => {
  it('hides a facts row of brand B inside withBrand(A)', async () => {
    const a = await t.makeBrand('A');
    const b = await t.makeBrand('B');
    const [row] = await withBrand(b, (tx) =>
      tx
        .insert(facts)
        .values({ brandId: b, section: 'identity', field: 'legal_name', value: 'B Pvt Ltd', language: 'en', status: 'approved', origin: 'owner' })
        .returning({ id: facts.id }),
    );
    expect(await withBrand(b, (tx) => tx.select().from(facts).where(eq(facts.id, row!.id)))).toHaveLength(1);
    expect(await withBrand(a, (tx) => tx.select().from(facts).where(eq(facts.id, row!.id)))).toHaveLength(0);
    expect(await withBrand(a, (tx) => tx.select().from(facts))).toHaveLength(0);
    // Nor can A write a row that claims to be B's.
    await expect(
      withBrand(a, (tx) =>
        tx.insert(facts).values({ brandId: b, section: 'identity', field: 'slug', value: 'x', language: 'en', status: 'approved', origin: 'owner' }),
      ),
    ).rejects.toThrow();
  });
});
