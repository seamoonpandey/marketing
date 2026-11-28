import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { testDb, type TestDb } from '../../test/helpers.ts';
import { config } from '../config.ts';
import { BudgetError } from '../http/errors.ts';
import { mockSearch } from './mock.ts';
import { search, searchReady, SearchUnavailable } from './index.ts';

let t: TestDb;
let brand: string;
const saved = { p: config.SEARCH_PROVIDER, k: config.SERPER_API_KEY, cap: config.AI_MONTHLY_CAP_NPR };
beforeAll(async () => {
  t = await testDb();
  brand = await t.makeBrand();
});
afterAll(() => t.close());
beforeEach(async () => {
  mockSearch.reset();
  await t.adminQuery('delete from cost_events');
});
afterEach(() => {
  config.SEARCH_PROVIDER = saved.p;
  config.SERPER_API_KEY = saved.k;
  config.AI_MONTHLY_CAP_NPR = saved.cap;
});

const run = (query: string) => search({ brandId: brand, runType: 'research_discovery', runId: 'run-1', query, kind: 'web', country: 'NP' });
const hit = { title: 'Momo Hut', url: 'https://momohut.com.np/', snippet: 's', place: null };

describe('search', () => {
  it('records one cost row per query, priced like Serper', async () => {
    mockSearch.set('web', 'momo kathmandu', [hit]);
    expect(await run('momo kathmandu')).toEqual([hit]);
    const rows = await t.adminQuery('select * from cost_events');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: 'mock', model: 'web', input_tokens: 1, output_tokens: 0, ok: true });
  });

  it('refuses a query over the monthly cap and calls no provider', async () => {
    config.AI_MONTHLY_CAP_NPR = '0';
    await expect(run('x')).rejects.toBeInstanceOf(BudgetError);
    expect(mockSearch.calls).toEqual([]);
  });

  it('records a failed query as not ok and rethrows', async () => {
    mockSearch.fail('web', 'x');
    await expect(run('x')).rejects.toThrow();
    const rows = await t.adminQuery('select * from cost_events');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ok: false });
  });

  it('searchReady throws 503 when Serper has no key', () => {
    config.SEARCH_PROVIDER = 'serper';
    config.SERPER_API_KEY = undefined;
    expect(searchReady).toThrow(SearchUnavailable);
    expect(() => searchReady()).toThrow(expect.objectContaining({ status: 503, code: 'search_unavailable' }));
  });
});
