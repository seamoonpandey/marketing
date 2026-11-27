import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { testDb, type TestDb } from '../../../test/helpers.ts';
import { mockAi } from '../../ai/index.ts';
import type { ApprovedFact } from '../../contracts/common.ts';
import { withBrand } from '../../db/tenant.ts';
import { createCompetitor } from '../brands/index.ts';
import { approveBattlecard, generateBattlecard, getBattlecards } from './battlecard.ts';

let t: TestDb;
beforeAll(async () => {
  t = await testDb();
});
afterAll(() => t.close());
afterEach(() => mockAi.reset());

const fact = { id: 'f1', section: 'products', subjectType: 'product', subjectId: null, subjectName: null, field: 'price', value: 4000, unit: 'NPR', language: 'en', sourceId: null, verifiedAt: '2026-11-01T00:00:00Z', expiresAt: null } as ApprovedFact;

describe('battlecard versions', () => {
  it('marks the first approved version replaced when a second draft is approved', async () => {
    const brand = await t.makeBrand();
    const rival = await withBrand(brand, (tx) => createCompetitor(tx, brand, { name: 'Rival' }));
    const answer = { differ: [{ text: 'Handmade', factIds: ['f1'] }], proof: [], objections: [{ text: 'Cheaper', observationIds: ['nope'] }], responses: [] };
    mockAi.queue(answer, answer);

    const one = await generateBattlecard(brand, rival.id, [fact]);
    expect(one).toMatchObject({ version: 1, status: 'draft' });
    expect(one.leftOut).toEqual([{ text: 'Cheaper', reason: 'no evidence' }]);
    await withBrand(brand, (tx) => approveBattlecard(tx, brand, rival.id));

    const two = await generateBattlecard(brand, rival.id, [fact]);
    expect(two.version).toBe(2);
    let pair = await withBrand(brand, (tx) => getBattlecards(tx, brand, rival.id));
    expect(pair.approved?.version).toBe(1);
    expect(pair.draft?.version).toBe(2);

    await withBrand(brand, (tx) => approveBattlecard(tx, brand, rival.id));
    pair = await withBrand(brand, (tx) => getBattlecards(tx, brand, rival.id));
    expect(pair.approved?.version).toBe(2);
    const rows = await t.adminQuery(`select version, status from battlecards where competitor_id = $1 order by version`, [rival.id]);
    expect(rows.map((r) => r.status)).toEqual(['replaced', 'approved']);
  });

  it("leaves out an objection whose quote is only in the model's own profile wording, not in a page quote", async () => {
    const brand = await t.makeBrand();
    const rival = await withBrand(brand, (tx) => createCompetitor(tx, brand, { name: 'Rival' }));
    const entry = { kind: 'positioning', text: 'Rated number one in Nepal by every buyer', price: null, quote: 'Hand-woven pashmina shawls from the Himalaya', url: 'https://r.example/', sourceId: rival.id };
    await t.adminQuery(
      `insert into competitor_profiles (tenant_id, brand_id, competitor_id, profile, run_id) values ($1, $2, $3, $4, gen_random_uuid())`,
      [t.tenantId, brand, rival.id, { entries: [entry] }],
    );
    mockAi.queue({
      differ: [], proof: [], responses: [],
      objections: [
        { text: 'They say they are number one', profileQuote: 'Rated number one in Nepal by every buyer' },
        { text: 'They say hand-woven', profileQuote: 'Hand-woven pashmina shawls from the Himalaya' },
      ],
    });
    const card = await generateBattlecard(brand, rival.id, []);
    expect((card.body as { objections: { text: string }[] }).objections.map((s) => s.text)).toEqual(['They say hand-woven']);
    expect(card.leftOut).toEqual([{ text: 'They say they are number one', reason: 'no evidence' }]);
  });
});
