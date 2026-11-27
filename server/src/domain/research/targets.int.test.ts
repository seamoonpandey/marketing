import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDb, type TestDb } from '../../../test/helpers.ts';
import { withBrand } from '../../db/tenant.ts';
import { createCompetitor } from '../brands/index.ts';
import { addTarget, listTargets } from './targets.ts';

let t: TestDb;
beforeAll(async () => {
  t = await testDb();
});
afterAll(() => t.close());

const rival = (brand: string, name: string) => withBrand(brand, (tx) => createCompetitor(tx, brand, { name }));

describe('watch list', () => {
  it('refuses a sixth page for one competitor and a target for an eleventh competitor', async () => {
    const brand = await t.makeBrand();
    const first = await rival(brand, 'R0');
    for (let i = 0; i < 5; i++)
      await withBrand(brand, (tx) => addTarget(tx, brand, { competitorId: first.id, url: `https://r0.example/p${i}` }));
    await expect(
      withBrand(brand, (tx) => addTarget(tx, brand, { competitorId: first.id, url: 'https://r0.example/p5' })),
    ).rejects.toThrow(/at most 5/);

    for (let i = 1; i < 10; i++) {
      const c = await rival(brand, `R${i}`);
      await withBrand(brand, (tx) => addTarget(tx, brand, { competitorId: c.id, url: `https://r${i}.example/` }));
    }
    const eleventh = await rival(brand, 'R10');
    await expect(
      withBrand(brand, (tx) => addTarget(tx, brand, { competitorId: eleventh.id, url: 'https://r10.example/' })),
    ).rejects.toThrow(/at most 10 competitors/);
  });

  it('refuses the brand\'s own site and the same URL twice', async () => {
    const brand = await t.makeBrand();
    await t.adminQuery(`update brands set website = 'https://www.own.example' where id = $1`, [brand]);
    const c = await rival(brand, 'Rival');
    await expect(
      withBrand(brand, (tx) => addTarget(tx, brand, { competitorId: c.id, url: 'https://own.example/pricing' })),
    ).rejects.toThrow(/own site/);
    await withBrand(brand, (tx) => addTarget(tx, brand, { competitorId: c.id, url: 'https://rival.example/a' }));
    await expect(
      withBrand(brand, (tx) => addTarget(tx, brand, { competitorId: c.id, url: 'https://rival.example/a#top' })),
    ).rejects.toThrow(/already/);
  });

  it("hides brand B's targets inside brand A", async () => {
    const a = await t.makeBrand();
    const b = await t.makeBrand();
    const c = await rival(b, 'Rival');
    await withBrand(b, (tx) => addTarget(tx, b, { competitorId: c.id, url: 'https://rival.example/' }));
    expect(await withBrand(a, (tx) => listTargets(tx, a))).toEqual([]);
    expect(await withBrand(b, (tx) => listTargets(tx, b))).toHaveLength(1);
  });
});
