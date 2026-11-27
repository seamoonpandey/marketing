import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDb, type TestDb } from '../../../test/helpers.ts';
import { createApp } from '../../app.ts';

let t: TestDb;
const app = createApp();
const get = async (brandId: string) => {
  const res = await app.request(`/api/brands/${brandId}/home`);
  return { status: res.status, body: (await res.json()) as any };
};
beforeAll(async () => {
  t = await testDb();
});
afterAll(() => t.close());

describe('GET /api/brands/{brandId}/home', () => {
  it('answers a new brand\'s setup path in the contract shape', async () => {
    const brand = await t.makeBrand('Himal Tea');
    const { status, body } = await get(brand);
    expect(status).toBe(200);
    expect(body).toMatchObject({
      brand: { id: brand, name: 'Himal Tea', timezone: 'Asia/Kathmandu' }, partial: [], paused: null, upcoming: [],
      items: [{ kind: 'setup_import', module: 'brand', urgency: 'today', count: null, due: null, href: `/app/b/${brand}/brand/sources` }],
    });
    expect(body.modules.map((m: { module: string }) => m.module)).toEqual(['publish', 'approve', 'studio', 'plan', 'research', 'brand']);
    expect(body.costs.byModule.map((m: { module: string }) => m.module)).toEqual(['brand', 'research', 'plan', 'studio']);
  });

  it("answers 404 and audits a denied event for another tenant's brand and for an id that is no brand", async () => {
    const [{ id: tenant }] = await t.adminQuery(`insert into tenants (slug, name) values ($1, 'Other') returning id`, [`other-${randomUUID().slice(0, 8)}`]);
    const [{ id: foreign }] = await t.adminQuery(`insert into brands (tenant_id, name, slug) values ($1, 'B', 'b-brand') returning id`, [tenant]);
    expect((await get(foreign)).status).toBe(404);
    expect((await get('not-a-brand')).status).toBe(404);
    expect((await t.adminQuery(`select 1 from audit_events where result = 'denied' and object_id = $1`, [foreign])).length).toBeGreaterThan(0);
  });
});
