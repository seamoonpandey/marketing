import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDb, type TestDb } from '../../../test/helpers.ts';
import { studioDrafts } from '../../db/schema/index.ts';
import { withBrand } from '../../db/tenant.ts';

let t: TestDb;
beforeAll(async () => {
  t = await testDb();
});
afterAll(() => t.close());

const ITEM = '0196f3c2-0000-7000-8000-0000000000aa';

describe('studio schema', () => {
  it('hides brand B drafts inside withBrand(A) and refuses a second draft for one plan item', async () => {
    const a = await t.makeBrand('A');
    const b = await t.makeBrand('B');
    const [row] = await withBrand(b, (tx) => tx.insert(studioDrafts).values({ brandId: b, planItemId: ITEM, kind: 'post' }).returning({ id: studioDrafts.id }));
    expect(await withBrand(b, (tx) => tx.select().from(studioDrafts))).toHaveLength(1);
    expect(await withBrand(a, (tx) => tx.select().from(studioDrafts))).toHaveLength(0);
    await expect(withBrand(a, (tx) => tx.insert(studioDrafts).values({ brandId: b, planItemId: ITEM, kind: 'post' }))).rejects.toThrow();
    await expect(withBrand(b, (tx) => tx.insert(studioDrafts).values({ brandId: b, planItemId: ITEM, kind: 'static' }))).rejects.toThrow();
    expect(row!.id).toBeTruthy();
  });
});
