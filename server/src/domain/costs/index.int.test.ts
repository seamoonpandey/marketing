import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDb, type TestDb } from '../../../test/helpers.ts';
import { withBrand } from '../../db/tenant.ts';
import { recordCost, remainingMonthlyCap } from './index.ts';

let t: TestDb;
let brandA: string;
let brandB: string;
beforeAll(async () => {
  t = await testDb();
  brandA = await t.makeBrand();
  brandB = await t.makeBrand();
});
afterAll(() => t.close());

describe('remainingMonthlyCap', () => {
  it('subtracts this month’s costs across the tenant’s brands, not last month’s', async () => {
    // 1M input + 100k output tokens of Opus 5.5 = NPR 930.48, recorded under brand B.
    await withBrand(brandB, (tx) =>
      recordCost(tx, {
        brandId: brandB, runType: 'test', runId: 'r1', model: 'anthropic:claude-opus-5-5',
        inputTokens: 1_000_000, outputTokens: 100_000, ok: true,
      }),
    );
    await t.adminQuery(
      `insert into cost_events (tenant_id, brand_id, run_type, run_id, provider, model, input_tokens, output_tokens,
         ok, rate_in_usd, rate_out_usd, usd_npr, cost_usd, cost_npr, created_at)
       values ($1, $2, 'test', 'old', 'anthropic', 'claude-opus-5-5', 1, 1, true, 4, 20, 155.08, 100, 15508,
         now() - interval '1 month')`,
      [t.tenantId, brandA],
    );
    const remaining = await withBrand(brandA, (tx) => remainingMonthlyCap(tx));
    expect(remaining).toEqual({ npr: '4069.52', usd: '26.2414' });
  });
});
