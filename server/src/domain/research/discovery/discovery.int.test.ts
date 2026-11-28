import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { launchTestWorkflows, testDb, type TestDb } from '../../../../test/helpers.ts';
import { mockAi } from '../../../ai/index.ts';
import { createApp } from '../../../app.ts';
import { config } from '../../../config.ts';
import { withBrand } from '../../../db/tenant.ts';
import { BudgetError, ConflictError, ValidationError } from '../../../http/errors.ts';
import { mockSearch, type SearchHit } from '../../../search/index.ts';
import { approveFact, enterFact } from '../../knowledge/index.ts';
import { suggestKeywords } from './keywords.ts';
import { confirmDiscovery, createDiscovery, getDiscovery, retryDiscovery } from './run.ts';

let t: TestDb;
let stop: () => Promise<void>;
const saved = { cap: config.AI_MONTHLY_CAP_NPR, provider: config.SEARCH_PROVIDER, key: config.SERPER_API_KEY };

beforeAll(async () => {
  t = await testDb();
  stop = await launchTestWorkflows(t);
});
afterAll(async () => {
  await stop();
  await t.close();
});
afterEach(() => {
  mockAi.reset();
  mockSearch.reset();
  config.AI_MONTHLY_CAP_NPR = saved.cap;
  config.SEARCH_PROVIDER = saved.provider;
  config.SERPER_API_KEY = saved.key;
});

const SETTLED = ['awaiting_approval', 'completed', 'failed_retryable', 'failed_final', 'cancelled'];
async function settle(brand: string, runId: string) {
  for (let i = 0; i < 400; i++) {
    const run = await withBrand(brand, (tx) => getDiscovery(tx, brand, runId));
    if (SETTLED.includes(run.state)) return run;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('run did not settle');
}

/** A brand with one approved fact. */
async function factBrand() {
  const brand = await t.makeBrand();
  await withBrand(brand, async (tx) => {
    const f = await enterFact(tx, brand, { section: 'positioning', field: 'proof', value: 'Hand-made momo in Lalitpur', language: 'en' });
    await approveFact(tx, brand, f.id);
  });
  return brand;
}
const hit = (title: string, url: string | null): SearchHit => ({ title, url, snippet: `${title} serves momo`, place: null });
const runCosts = async (runId: string) => (await t.adminQuery(`select 1 from cost_events where run_id = $1`, [runId])).length;
const runs = async (brand: string) => (await t.adminQuery(`select 1 from discovery_runs where brand_id = $1`, [brand])).length;

describe('keyword suggestions', () => {
  it('suggests keywords from approved facts', async () => {
    const brand = await factBrand();
    mockAi.queue({ keywords: ['momo restaurant Kathmandu', 'Momo restaurant kathmandu', 'frozen momo Nepal', 'm'.repeat(81)] });
    expect(await suggestKeywords(brand)).toEqual(['momo restaurant Kathmandu', 'frozen momo Nepal']);
    expect(mockAi.calls).toHaveLength(1);
    const text = mockAi.calls[0]!.parts.map((p) => (p.type === 'text' ? p.text : '')).join('\n');
    expect(text).toContain('<approved_facts>');
    expect(text).toContain('Hand-made momo in Lalitpur');
  });

  it('refuses to suggest keywords for a brand with no approved facts (400)', async () => {
    const brand = await t.makeBrand();
    await expect(suggestKeywords(brand)).rejects.toThrow(ValidationError);
    expect(mockAi.calls).toHaveLength(0);
  });
});

describe('discovery run', () => {
  it('searches nothing and records no cost before the owner confirms', async () => {
    const brand = await factBrand();
    const { runId } = await createDiscovery(brand, ['momo kathmandu']);
    const run = await withBrand(brand, (tx) => getDiscovery(tx, brand, runId));
    expect(run.state).toBe('awaiting_approval');
    expect(Number(run.estimate!.npr)).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 300));
    expect(mockSearch.calls).toEqual([]);
    expect(await runCosts(runId)).toBe(0);
  });

  it('runs one web and one Maps query per keyword after confirm and records each', async () => {
    const brand = await factBrand();
    mockSearch.set('web', 'momo kathmandu', [hit('Momo Hut', 'https://momohut.com.np/'), hit('Trick', 'javascript:alert(1)')]);
    mockSearch.set('places', 'frozen momo Nepal', [hit('Momo House', null)]);
    const { runId } = await createDiscovery(brand, ['momo kathmandu', 'frozen momo Nepal']);
    await confirmDiscovery(brand, runId);
    const run = await settle(brand, runId);
    expect(run.state).toBe('completed');
    expect(mockSearch.calls).toHaveLength(4);
    expect(mockSearch.calls.every((c) => c.country === 'NP')).toBe(true);
    expect(await runCosts(runId)).toBe(4);
    expect(run.counts).toMatchObject({ queries: 4, failedQueries: 0, results: 3 });
    expect(run.results.map((r) => [r.id, r.kind, r.query, r.url])).toEqual([
      ['r1', 'web', 'momo kathmandu', 'https://momohut.com.np/'],
      ['r2', 'web', 'momo kathmandu', null],
      ['r3', 'places', 'frozen momo Nepal', null],
    ]);
    expect(Number(run.actual!.npr)).toBeGreaterThan(0);
  });

  it('refuses to confirm a run whose estimate is above the remaining cap', async () => {
    const brand = await factBrand();
    const { runId } = await createDiscovery(brand, ['momo kathmandu']);
    config.AI_MONTHLY_CAP_NPR = '1';
    await expect(confirmDiscovery(brand, runId)).rejects.toThrow(BudgetError);
    expect((await withBrand(brand, (tx) => getDiscovery(tx, brand, runId))).state).toBe('awaiting_approval');
  });

  it('answers 503 and creates no run when Serper has no key', async () => {
    const brand = await factBrand();
    config.SEARCH_PROVIDER = 'serper';
    config.SERPER_API_KEY = undefined;
    const res = await createApp().request(`/api/brands/${brand}/research/discoveries`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ keywords: ['momo kathmandu'] }),
    });
    expect(res.status).toBe(503);
    expect(await runs(brand)).toBe(0);
  });

  it('refuses a second active run with 409', async () => {
    const brand = await factBrand();
    await createDiscovery(brand, ['momo kathmandu']);
    await expect(createDiscovery(brand, ['frozen momo'])).rejects.toThrow(ConflictError);
    expect(await runs(brand)).toBe(1);
  });

  it('counts a failing query and carries on', async () => {
    const brand = await factBrand();
    mockSearch.fail('places', 'momo kathmandu');
    const { runId } = await createDiscovery(brand, ['momo kathmandu']);
    await confirmDiscovery(brand, runId);
    const run = await settle(brand, runId);
    expect(run.state).toBe('completed');
    expect(run.counts).toMatchObject({ queries: 2, failedQueries: 1 });
  });

  it('fails retryable when every query fails, and a retry searches again', async () => {
    const brand = await factBrand();
    mockSearch.fail('web', 'momo kathmandu');
    mockSearch.fail('places', 'momo kathmandu');
    const { runId } = await createDiscovery(brand, ['momo kathmandu']);
    await confirmDiscovery(brand, runId);
    const failed = await settle(brand, runId);
    expect(failed.state).toBe('failed_retryable');
    expect(failed.error).toBe('Every search failed; retry the run');

    mockSearch.reset();
    mockSearch.set('web', 'momo kathmandu', [hit('Momo Hut', 'https://momohut.com.np/')]);
    await retryDiscovery(brand, runId);
    const run = await settle(brand, runId);
    expect(run.state).toBe('completed');
    expect(mockSearch.calls).toHaveLength(2);
    expect(run.counts).toMatchObject({ queries: 2, failedQueries: 0, results: 1 });
  });
});
