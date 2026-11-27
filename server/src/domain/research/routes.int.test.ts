import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchTestWorkflows, testDb, type TestDb } from '../../../test/helpers.ts';
import { createApp } from '../../app.ts';
import { withBrand } from '../../db/tenant.ts';
import { createCompetitor } from '../brands/index.ts';
import { addTarget } from './targets.ts';

let t: TestDb;
let stop: () => Promise<void>;
const app = createApp();
const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(`/api${path}`, {
    method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (res.status === 204 ? null : await res.json()) as any };
};
const denied = async (id: string) => (await t.adminQuery(`select 1 from audit_events where result = 'denied' and object_id = $1`, [id])).length;

beforeAll(async () => {
  t = await testDb();
  stop = await launchTestWorkflows(t);
});
afterAll(async () => {
  await stop();
  await t.close();
});

describe('research API', () => {
  it("answers 404 and audits a denied event for brand B's target, battlecard and profile through brand A", async () => {
    const a = await t.makeBrand();
    const b = await t.makeBrand();
    const rival = await withBrand(b, (tx) => createCompetitor(tx, b, { name: 'B rival' }));
    const target = await withBrand(b, (tx) => addTarget(tx, b, { competitorId: rival.id, url: 'https://b-rival.example/' }));
    await t.adminQuery(
      `insert into observations (tenant_id, brand_id, competitor_id, run_id, type, summary, after, url, confidence)
       values ($1, $2, $3, gen_random_uuid(), 'other', 'B only', '{"quote":"b quote text here","sourceId":"x"}', 'https://b-rival.example/', 'low')`,
      [t.tenantId, b, rival.id],
    );

    expect((await call('PATCH', `/brands/${a}/research/targets/${target.id}`, { status: 'paused' })).status).toBe(404);
    expect(await denied(target.id)).toBe(1);
    expect((await call('GET', `/brands/${a}/research/competitors/${rival.id}/battlecard`)).status).toBe(404);
    expect((await call('GET', `/brands/${a}/research/competitors/${rival.id}/profile`)).status).toBe(404);
    expect(await denied(rival.id)).toBe(2);
    expect((await call('GET', `/brands/${a}/research/observations`)).body).toEqual([]);
    expect((await call('GET', `/brands/${a}/research/observations?competitorId=${rival.id}`)).body).toEqual([]);
    expect((await call('GET', `/brands/${b}/research/observations`)).body).toHaveLength(1);
  });

  it('answers 409 with the shared error shape for a run while one is active', async () => {
    const brand = await t.makeBrand();
    const [{ id: runId }] = await t.adminQuery(
      `insert into watch_runs (tenant_id, brand_id, trigger, state) values ($1, $2, 'manual', 'running') returning id`,
      [t.tenantId, brand],
    );
    const second = await call('POST', `/brands/${brand}/research/runs`, {});
    expect(second.status).toBe(409);
    expect(second.body).toEqual({ error: { code: 'conflict', message: expect.any(String) } });
    expect((await call('GET', `/brands/${brand}/research/runs/${runId}`)).body.state).toBe('running');
    expect((await call('GET', `/brands/${brand}/research/schedule`)).body).toMatchObject({ enabled: false, weekday: 1, hour: 6 });
    expect((await call('PUT', `/brands/${brand}/research/schedule`, { enabled: true, weekday: 2, hour: 7 })).body).toMatchObject({ enabled: true, weekday: 2 });
  });
});
