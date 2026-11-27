// The design's six acceptance cases (section 6), through the exported gate and the routes.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDb, type TestDb } from '../../../test/helpers.ts';
import { createApp } from '../../app.ts';
import { withBrand } from '../../db/tenant.ts';
import { approvedFacts, enterFact } from '../knowledge/index.ts';
import { validApproval, type Approval } from './index.ts';
import { routeStudio } from './routes.ts';
import { content, fakeStudio, fakeTenant, hashOf } from './studio.fake.ts';

let t: TestDb;
const studio = fakeStudio();
const real = routeStudio.reads;
beforeAll(async () => {
  t = await testDb();
  fakeTenant.id = t.tenantId;
  routeStudio.reads = async () => studio.reads;
});
afterAll(async () => {
  routeStudio.reads = real;
  await t.close();
});

const app = createApp();
const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(`/api${path}`, {
    method, headers: body !== undefined ? { 'content-type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as any };
};
const gate = (brand: string, draftId: string): Promise<Approval | null> =>
  withBrand(brand, async (tx) => validApproval(tx, brand, draftId, await approvedFacts(tx, brand), studio.reads));
const state = async (brand: string, draftId: string) => (await call('GET', `/brands/${brand}/approve/queue/${draftId}`)).body.state;
const approveVia = (brand: string, draftId: string, payloadHash: string, reviewNote?: string) =>
  call('POST', `/brands/${brand}/approve/queue/${draftId}/approve`, { payloadHash, reviewNote });

describe('approve acceptance (design section 6)', () => {
  it('1. refuses an approval whose hash no longer matches the draft', async () => {
    const brand = await t.makeBrand();
    const d = studio.put(brand);
    const opened = hashOf(d);
    studio.edit(brand, d.id, { status: 'ready', readyVersion: 2, content: content('Changed after the owner opened it') });
    expect((await approveVia(brand, d.id, opened)).body.error.message).toBe('changed since you opened it');
    expect(await gate(brand, d.id)).toBeNull();
    expect(await state(brand, d.id)).toBe('waiting');
  });

  it('2. (AT-013) an edit after approval makes the state invalid with no action here', async () => {
    const brand = await t.makeBrand();
    const d = studio.put(brand);
    expect((await approveVia(brand, d.id, hashOf(d))).status).toBe(200);
    expect(await gate(brand, d.id)).not.toBeNull();
    studio.edit(brand, d.id, { content: content('Edited in Studio') });
    expect(await state(brand, d.id)).toBe('invalid');
    expect(await gate(brand, d.id)).toBeNull();
  });

  it('3. a cited fact that expires makes the approval invalid', async () => {
    const brand = await t.makeBrand();
    const until = new Date(Date.now() + 86_400_000).toISOString();
    const f = await withBrand(brand, (tx) => enterFact(tx, brand, { section: 'identity', field: 'trading_name', value: 'Thamel Shawls', language: 'en', expiresAt: until }));
    const d = studio.put(brand, { factIds: [f.id] });
    const ok = await approveVia(brand, d.id, hashOf(d));
    expect(ok.body.history[0].expiresAt).toBe(until); // the fact's expiry is the earliest
    expect(await gate(brand, d.id)).not.toBeNull();
    await t.adminQuery(`update facts set expires_at = now() - interval '1 second' where id = $1`, [f.id]);
    expect(await state(brand, d.id)).toBe('invalid');
    expect(await gate(brand, d.id)).toBeNull();
  });

  it('4. a high-risk draft needs a review note and cannot be in a bulk approval', async () => {
    const brand = await t.makeBrand();
    await withBrand(brand, (tx) => enterFact(tx, brand, { section: 'identity', field: 'industry', value: 'Pharmacy', language: 'en' }));
    const d = studio.put(brand);
    await call('GET', `/brands/${brand}/approve/queue/${d.id}`);
    expect(await approveVia(brand, d.id, hashOf(d))).toMatchObject({ status: 409, body: { error: { message: expect.stringMatching(/review note/) } } });
    expect(await approveVia(brand, d.id, hashOf(d), 'too short')).toMatchObject({ status: 409 });
    expect((await call('POST', `/brands/${brand}/approve/bulk-approve`, { items: [{ draftId: d.id, payloadHash: hashOf(d) }] })).status).toBe(409);
    expect(await gate(brand, d.id)).toBeNull();
    const ok = await approveVia(brand, d.id, hashOf(d), 'Pharmacist confirmed the dosage wording.');
    expect(ok).toMatchObject({ status: 200, body: { state: 'approved', history: [{ risk: 'high', reviewNote: 'Pharmacist confirmed the dosage wording.' }] } });
    expect(await gate(brand, d.id)).not.toBeNull();
  });

  it('5. while the brand is paused the gate returns nothing for an approved draft', async () => {
    const brand = await t.makeBrand();
    const d = studio.put(brand);
    await approveVia(brand, d.id, hashOf(d));
    expect(await gate(brand, d.id)).not.toBeNull();
    expect((await call('POST', `/brands/${brand}/approve/pause`, { reason: 'Brand under review' })).status).toBe(200);
    expect(await gate(brand, d.id)).toBeNull();
    expect(await state(brand, d.id)).toBe('paused');
    expect((await call('POST', `/brands/${brand}/approve/resume`, { reason: 'Review done' })).status).toBe(200);
    expect(await gate(brand, d.id)).not.toBeNull();
  });

  it("6. brand B's approvals cannot be read or given through brand A's path", async () => {
    const a = await t.makeBrand();
    const b = await t.makeBrand();
    const d = studio.put(b);
    expect((await approveVia(a, d.id, hashOf(d))).status).toBe(404);
    expect((await approveVia(b, d.id, hashOf(d))).status).toBe(200);
    expect((await call('GET', `/brands/${a}/approve/queue/${d.id}`)).status).toBe(404);
    expect((await call('GET', `/brands/${a}/approve/queue`)).body.items).toEqual([]);
    expect(await gate(a, d.id)).toBeNull();
    expect(await gate(b, d.id)).not.toBeNull();
  });
});
