import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { testDb, type TestDb } from '../../test/helpers.ts';
import { BudgetError } from '../http/errors.ts';
import { AiError, extract, mockAi } from './index.ts';

let t: TestDb;
let brand: string;
beforeAll(async () => {
  t = await testDb();
  brand = await t.makeBrand();
});
afterAll(() => t.close());
beforeEach(async () => {
  mockAi.reset();
  await t.adminQuery('delete from cost_events');
});

const schema = z.object({ name: z.string(), founded: z.number().int() });
const run = () =>
  extract({
    brandId: brand, runType: 'test', runId: 'run-1', system: 'Extract the brand.',
    parts: [{ type: 'text', text: '<source id="s1">Himal Tea House, founded 1998.</source>' }], schema,
  });
const costRows = () => t.adminQuery('select * from cost_events order by created_at');

describe('extract', () => {
  it('returns the parsed object and records one cost row with its rate snapshot', async () => {
    mockAi.queue({ name: 'Himal Tea House', founded: 1998 });
    const r = await run();
    expect(r.object).toEqual({ name: 'Himal Tea House', founded: 1998 });
    expect(Number(r.cost.npr)).toBeGreaterThan(0);
    const rows = await costRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      ok: true, run_type: 'test', run_id: 'run-1', brand_id: brand,
      rate_in_usd: '4.000000', rate_out_usd: '20.000000', usd_npr: '155.0800',
    });
    expect(rows[0].input_tokens).toBeGreaterThan(0);
    expect(mockAi.calls[0]!.system).toContain('Extract the brand.');
    expect(mockAi.calls[0]!.parts).toEqual([{ type: 'text', text: '<source id="s1">Himal Tea House, founded 1998.</source>' }]);
  });

  it('makes exactly one repair call, then fails closed', async () => {
    mockAi.queue({ name: 'Himal' }, 'not json at all');
    await expect(run()).rejects.toMatchObject({ name: 'AiError', retryable: false });
    expect(mockAi.calls).toHaveLength(2);
    expect((await costRows()).map((r) => r.ok)).toEqual([false, false]);
  });

  it('succeeds when the repair answer is valid', async () => {
    mockAi.queue({ name: 'Himal' }, { name: 'Himal', founded: 1998 });
    expect((await run()).object).toEqual({ name: 'Himal', founded: 1998 });
    expect((await costRows()).map((r) => r.ok)).toEqual([false, true]);
  });

  it('throws BudgetError before calling when the estimate exceeds the remaining cap', async () => {
    await t.adminQuery(
      `insert into cost_events (tenant_id, brand_id, run_type, run_id, provider, model, input_tokens, output_tokens,
         ok, rate_in_usd, rate_out_usd, usd_npr, cost_usd, cost_npr)
       values ($1, $2, 'test', 'big', 'anthropic', 'claude-opus-5-5', 1, 1, true, 4, 20, 155.08, 32.24, 4999.99)`,
      [t.tenantId, brand],
    );
    mockAi.queue({ name: 'x', founded: 1 });
    await expect(run()).rejects.toBeInstanceOf(BudgetError);
    expect(mockAi.calls).toEqual([]);
  });

  it('treats a refusal as final', async () => {
    mockAi.queue(mockAi.refusal);
    const e = await run().catch((err) => err);
    expect(e).toBeInstanceOf(AiError);
    expect(e.retryable).toBe(false);
    expect((await costRows()).map((r) => r.ok)).toEqual([false]);
  });

  it('passes no tools to the model', async () => {
    mockAi.queue({ name: 'Himal', founded: 1998 });
    await run();
    expect(mockAi.calls[0]!.tools ?? []).toEqual([]);
  });
});
