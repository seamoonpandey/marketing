import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDb, type TestDb } from '../../../test/helpers.ts';
import { createApp } from '../../app.ts';
import { ensureBucket } from '../../storage/index.ts';

let t: TestDb;
const app = createApp();

const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(`/api${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (res.status === 204 ? null : await res.json()) as any };
};
const denied = async (objectId: string) =>
  (await t.adminQuery(`select * from audit_events where result = 'denied' and object_id = $1`, [objectId])).length;

beforeAll(async () => {
  await ensureBucket();
  t = await testDb();
});
afterAll(() => t.close());

describe('brands API', () => {
  it('creates a brand (201, audited), and a second of the same name gets another slug', async () => {
    const a = await call('POST', '/brands', { name: 'Himal Tea House', website: 'https://himal.example' });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ name: 'Himal Tea House', slug: 'himal-tea-house', status: 'active', currency: 'NPR' });
    const events = await t.adminQuery(`select * from audit_events where action = 'brand.create' and object_id = $1`, [a.body.id]);
    expect(events).toHaveLength(1);

    const b = await call('POST', '/brands', { name: 'Himal Tea House' });
    expect(b.body.slug).toBe('himal-tea-house-2');

    const list = await call('GET', '/brands');
    expect(list.body.map((x: { id: string }) => x.id)).toEqual(expect.arrayContaining([a.body.id, b.body.id]));
  });

  it('gives a name with no Latin letters a unique slug', async () => {
    const a = await call('POST', '/brands', { name: 'हिमाल पश्मिना' });
    const b = await call('POST', '/brands', { name: 'हिमाल पश्मिना' });
    expect(a.body.slug).toBeTruthy();
    expect(b.body.slug).toBeTruthy();
    expect(a.body.slug).not.toBe(b.body.slug);
  });

  it('answers 400 with the error body for an invalid request', async () => {
    const r = await call('POST', '/brands', { name: '' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('validation');
  });

  it('answers a body that is not JSON, or an empty update, with the error body and not 500', async () => {
    const { body: brand } = await call('POST', '/brands', { name: 'Bodies' });
    const { body: rival } = await call('POST', `/brands/${brand.id}/competitors`, { name: 'Rival' });
    const send = (method: string, path: string, body: string, headers: Record<string, string> = {}) =>
      app.request(`/api${path}`, { method, headers, body });
    for (const [res, status] of [
      [await send('POST', '/brands', '{bad', { 'content-type': 'application/json' }), 400],
      [await send('POST', `/brands/${brand.id}/competitors`, '{"name":"x"}'), 415],
      [await send('PATCH', `/brands/${brand.id}`, '{}', { 'content-type': 'application/json' }), 400],
      [await send('PATCH', `/brands/${brand.id}/competitors/${rival.id}`, '{}', { 'content-type': 'application/json' }), 400],
    ] as const) {
      expect(res.status).toBe(status);
      expect(((await res.json()) as any).error.code).toBe('validation');
    }
  });

  it('updates and archives a brand, keeping its audit and cost rows', async () => {
    const { body: brand } = await call('POST', '/brands', { name: 'Archive me' });
    expect((await call('PATCH', `/brands/${brand.id}`, { website: 'https://archive.example' })).body.website).toBe(
      'https://archive.example',
    );
    await t.adminQuery(
      `insert into cost_events (tenant_id, brand_id, run_type, run_id, provider, model, input_tokens, output_tokens,
         ok, rate_in_usd, rate_out_usd, usd_npr, cost_usd, cost_npr)
       values ($1, $2, 'import', 'r1', 'anthropic', 'claude-opus-5-5', 1000, 100, true, 4, 20, 155.08, 0.006, 0.93)`,
      [t.tenantId, brand.id],
    );
    const auditBefore = (await call('GET', `/brands/${brand.id}/audit`)).body.length;
    const archived = await call('POST', `/brands/${brand.id}/archive`);
    expect(archived.body.status).toBe('archived');

    const auditAfter = await call('GET', `/brands/${brand.id}/audit`);
    expect(auditAfter.body).toHaveLength(auditBefore + 1);
    expect(auditAfter.body[0].action).toBe('brand.archive');
    const costs = await call('GET', `/brands/${brand.id}/costs`);
    expect(costs.body.total).toEqual({ usd: '0.0060', npr: '0.93' });
    expect(costs.body.runs).toHaveLength(1);
    expect(costs.body.cap.npr).toBe('5000.00');
  });

  it('manages competitors', async () => {
    const { body: brand } = await call('POST', '/brands', { name: 'Rivals' });
    const c = await call('POST', `/brands/${brand.id}/competitors`, { name: 'Other Tea', kind: 'direct', handles: { instagram: '@other' } });
    expect(c.status).toBe(201);
    expect((await call('PATCH', `/brands/${brand.id}/competitors/${c.body.id}`, { priority: 1 })).body.priority).toBe(1);
    expect((await call('GET', `/brands/${brand.id}/competitors`)).body).toHaveLength(1);
    expect((await call('DELETE', `/brands/${brand.id}/competitors/${c.body.id}`)).status).toBe(204);
    expect((await call('GET', `/brands/${brand.id}/competitors`)).body).toHaveLength(0);
  });

  it("answers 404 with one denied event for brand B's competitor and source through brand A's path", async () => {
    const { body: a } = await call('POST', '/brands', { name: 'Brand A' });
    const { body: b } = await call('POST', '/brands', { name: 'Brand B' });
    const { body: compB } = await call('POST', `/brands/${b.id}/competitors`, { name: 'B rival' });
    const { body: upB } = await call('POST', `/brands/${b.id}/sources/uploads`, {
      filename: 'b.pdf', mime: 'application/pdf', bytes: 100,
    });

    const patch = await call('PATCH', `/brands/${a.id}/competitors/${compB.id}`, { name: 'stolen' });
    expect(patch.status).toBe(404);
    expect(patch.body.error.code).toBe('not_found');
    expect(await denied(compB.id)).toBe(1);

    expect((await call('DELETE', `/brands/${a.id}/competitors/${compB.id}`)).status).toBe(404);
    expect(await denied(compB.id)).toBe(2);

    const get = await call('GET', `/brands/${a.id}/sources/${upB.source.id}`);
    expect(get.status).toBe(404);
    expect(JSON.stringify(get.body)).not.toContain('http');
    expect(await denied(upB.source.id)).toBe(1);

    const complete = await call('POST', `/brands/${a.id}/sources/${upB.source.id}/complete`);
    expect(complete.status).toBe(404);
    expect(JSON.stringify(complete.body)).not.toContain('http');
    expect(await denied(upB.source.id)).toBe(2);

    // B's competitor is untouched.
    expect((await call('GET', `/brands/${b.id}/competitors`)).body[0].name).toBe('B rival');
  });

  it('answers 404 for an unknown brand', async () => {
    expect((await call('GET', '/brands/00000000-0000-7000-8000-000000000000')).status).toBe(404);
    expect((await call('GET', '/brands/not-a-uuid')).status).toBe(404);
  });
});
