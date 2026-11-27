import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { testDb, type TestDb } from '../../../test/helpers.ts';
import { mockAi } from '../../ai/index.ts';
import { withBrand } from '../../db/tenant.ts';
import { decideOpportunity, generateOpportunities, listOpportunities } from './opportunities.ts';

let t: TestDb;
beforeAll(async () => {
  t = await testDb();
});
afterAll(() => t.close());
afterEach(() => mockAi.reset());

const RUN = '01900000-0000-7000-8000-000000000001';
async function withObservation(brand: string) {
  const [c] = await t.adminQuery(`select gen_random_uuid() as id`);
  const [o] = await t.adminQuery(
    `insert into observations (tenant_id, brand_id, competitor_id, run_id, type, summary, after, url, confidence)
     values ($1, $2, $3, $4, 'price_change', 'Price dropped', '{"quote":"Rs 4,500 for a classic shawl","sourceId":"x"}', 'https://r.example/', 'high') returning id`,
    [t.tenantId, brand, c.id, RUN],
  );
  return o.id as string;
}
const opp = (ids: string[]) => ({
  opportunities: [{ title: 'Answer the price cut', hypothesis: 'Rivals chase price', suggestedAction: 'Run a bundle offer', whyItMatters: 'Shoppers compare', observationIds: ids, confidence: 'medium' }],
});

describe('opportunities', () => {
  it('stores one citing a real observation as new and drops one citing an unknown id', async () => {
    const brand = await t.makeBrand();
    const id = await withObservation(brand);
    mockAi.queue({ opportunities: [...opp([id]).opportunities, ...opp(['01900000-0000-7000-8000-0000000000ff']).opportunities, ...opp([]).opportunities] });
    const made = await generateOpportunities(brand, RUN, []);
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ status: 'new', observationIds: [id] });
    expect(await withBrand(brand, (tx) => listOpportunities(tx, brand, 'new'))).toHaveLength(1);
  });

  it("drops one citing an observation of the same brand from another run", async () => {
    const brand = await t.makeBrand();
    const old = await withObservation(brand);
    await t.adminQuery(`update observations set run_id = gen_random_uuid() where id = $1`, [old]);
    const fresh = await withObservation(brand);
    mockAi.queue({ opportunities: [...opp([old]).opportunities, ...opp([fresh]).opportunities] });
    const made = await generateOpportunities(brand, RUN, []);
    expect(made.map((o) => o.observationIds)).toEqual([[fresh]]);
  });

  it('makes no model call when the run has no observation', async () => {
    const brand = await t.makeBrand();
    expect(await generateOpportunities(brand, RUN, [])).toEqual([]);
    expect(mockAi.calls).toHaveLength(0);
  });

  it('records a decision with its time and an audit event', async () => {
    const brand = await t.makeBrand();
    const id = await withObservation(brand);
    mockAi.queue(opp([id]));
    const [o] = await generateOpportunities(brand, RUN, []);
    const done = await withBrand(brand, (tx) => decideOpportunity(tx, brand, o!.id, 'accepted'));
    expect(done.status).toBe('accepted');
    expect(done.decidedAt).toBeInstanceOf(Date);
    expect(await t.adminQuery(`select 1 from audit_events where action = 'research.opportunity.accepted' and object_id = $1`, [o!.id])).toHaveLength(1);
  });
});
