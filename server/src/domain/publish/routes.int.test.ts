import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDb, type TestDb } from '../../../test/helpers.ts';
import { createApp } from '../../app.ts';
import { fakeReads } from './fake-reads.ts';
import { testReads } from './reads.ts';

let t: TestDb;
const app = createApp();
const fake = fakeReads();
beforeAll(async () => {
  t = await testDb();
  testReads.current = fake.reads;
});
afterAll(async () => {
  delete testReads.current;
  await t.close();
});

const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(`/api${path}`, {
    method, headers: body !== undefined ? { 'content-type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as any };
};
const denied = async (id: string) => (await t.adminQuery(`select 1 from audit_events where result = 'denied' and object_id = $1`, [id])).length;
const DAY = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
const AT = `${DAY}T10:00:00+05:45`;
const key = (brand: string, name: string) => `tenant/${t.tenantId}/brand/${brand}/asset/${name}.png`;
const render = (brand: string, name: string, ratio = '1:1', index = 0) => ({ ratio, key: key(brand, name), width: 1080, height: 1080, sha256: 's', index, type: 'image' as const });

async function brandWithJob() {
  const brand = await t.makeBrand();
  const p = `/brands/${brand}/publish`;
  const channel = (await call('POST', `${p}/channels`, { platform: 'instagram', accountName: '@shop' })).body;
  const draft = fake.add(brand, { kind: 'static', renders: [render(brand, 'a'), render(brand, 'b', '16:9')] });
  const job = await call('POST', `${p}/jobs`, { draftId: draft.id, channelId: channel.id, scheduledAt: AT });
  expect(job.status).toBe(201);
  return { brand, p, channel, draft, job: job.body };
}

describe('publish API', () => {
  it("answers 404 with a denied event for brand B's job, channel and package through brand A's path; media URLs only for the path's brand", async () => {
    const a = await brandWithJob();
    const b = await brandWithJob();
    const id = b.job.id;
    expect((await call('GET', `${a.p}/jobs/${id}`)).status).toBe(404);
    for (const [path, body] of [['cancel'], ['retry'], ['reschedule', { scheduledAt: AT }], ['confirm-manual', { url: 'https://x.com/1' }], ['resolve-unknown', { posted: false }]] as const)
      expect((await call('POST', `${a.p}/jobs/${id}/${path}`, body)).status).toBe(404);
    expect(await denied(id)).toBe(6);
    expect((await call('PATCH', `${a.p}/channels/${b.channel.id}`, { status: 'disabled' })).status).toBe(404);
    expect(await denied(b.channel.id)).toBe(1);
    // Scheduling brand B's draft or onto brand B's channel from brand A.
    expect((await call('POST', `${a.p}/jobs`, { draftId: b.draft.id, channelId: a.channel.id, scheduledAt: AT })).status).toBe(404);
    expect((await call('POST', `${a.p}/jobs`, { draftId: a.draft.id, channelId: b.channel.id, scheduledAt: AT })).status).toBe(404);
    expect((await t.adminQuery(`select state from publish_jobs where id = $1`, [id]))[0].state).toBe('scheduled');
    expect((await call('GET', `${a.p}/jobs`)).body.jobs.map((j: any) => j.id)).toEqual([a.job.id]);

    const own = await call('GET', `${b.p}/jobs/${id}`);
    expect(own.status).toBe(200);
    expect(own.body.package).toMatchObject({ available: true, ratio: '1:1', captions: [{ language: 'en', hashtags: ['#shawl'], cta: 'Visit the shop' }] });
    expect(own.body.package.media).toHaveLength(1);
    expect(own.body.package.media[0].url).toContain(`/brand/${b.brand}/asset/a.png`);
    expect(own.body.package.media[0].url).toMatch(/X-Amz-Signature=/);

    // A draft of brand A whose render points at brand B's storage gets no URL.
    const sneaky = fake.add(a.brand, { kind: 'static', renders: [render(b.brand, 'a')] });
    const j = (await call('POST', `${a.p}/jobs`, { draftId: sneaky.id, channelId: a.channel.id, scheduledAt: AT })).body;
    expect((await call('GET', `${a.p}/jobs/${j.id}`)).body.package).toEqual({ available: false, reason: expect.stringMatching(/not stored for this brand/), ratio: null, captions: [], media: [] });
  });

  it('GET /schedulable lists only drafts the gate approves, with the reason each channel does not fit', async () => {
    const brand = await t.makeBrand();
    const p = `/brands/${brand}/publish`;
    const x = (await call('POST', `${p}/channels`, { platform: 'x', accountName: '@x' })).body;
    const ig = (await call('POST', `${p}/channels`, { platform: 'instagram', accountName: '@ig' })).body;
    const off = (await call('POST', `${p}/channels`, { platform: 'facebook', accountName: '@fb' })).body;
    await call('PATCH', `${p}/channels/${off.id}`, { status: 'disabled' });
    const wide = fake.add(brand, { kind: 'static', day: '2026-12-02', renders: [render(brand, 'w', '16:9')] });
    fake.add(brand, {}, null); // ready, not approved
    const post = fake.add(brand, { day: '2026-12-01' });
    await call('POST', `${p}/jobs`, { draftId: post.id, channelId: x.id, scheduledAt: AT });

    const { status, body } = await call('GET', `${p}/schedulable`);
    expect(status).toBe(200);
    expect(body.settings).toEqual({ windowStart: 7, windowEnd: 21, maxAttempts: 3 });
    expect(body.drafts.map((d: any) => d.draftId)).toEqual([post.id, wide.id]);
    const reasons = (d: any) => Object.fromEntries(d.channels.map((c: any) => [c.platform, c.reason]));
    expect(reasons(body.drafts[0]).x).toBe('Already scheduled to this channel');
    expect(reasons(body.drafts[0]).instagram).toBeNull(); // a post with no render fits instagram's text
    expect(reasons(body.drafts[0]).facebook).toBe('The channel is disabled');
    expect(reasons(body.drafts[1]).instagram).toMatch(/No image in a shape instagram accepts/);
    expect(reasons(body.drafts[1]).x).toBeNull();
    expect(body.drafts[1].channels.find((c: any) => c.channelId === ig.id).fits).toBe(false);
    expect(body.drafts[1].thumbnailUrl).toMatch(/X-Amz-Signature=/);
    expect(body.drafts[0]).toMatchObject({ kind: 'post', excerpt: 'Warm pashmina shawls, woven in Kathmandu.', thumbnailUrl: null, version: 1 });
  });

  it('answers 400 with the base error shape for every bad body and query', async () => {
    const { p, job, channel, draft } = await brandWithJob();
    const bad = [
      await call('POST', `${p}/channels`, { platform: 'myspace', accountName: '@a' }),
      await call('POST', `${p}/channels`, { platform: 'x', accountName: '' }),
      await call('POST', `${p}/channels`, { platform: 'x', accountName: '@a', accountUrl: 'javascript:alert(1)' }),
      await call('POST', `${p}/channels`, {}),
      await call('PATCH', `${p}/channels/${channel.id}`, { status: 'needs_reconnect' }),
      await call('PATCH', `${p}/channels/${channel.id}`, { accountUrl: 'not a url' }),
      await call('POST', `${p}/jobs`, { draftId: draft.id, channelId: channel.id }),
      await call('POST', `${p}/jobs`, { draftId: draft.id, channelId: channel.id, scheduledAt: '2026-12-01T10:00' }),
      await call('POST', `${p}/jobs`, { draftId: draft.id, channelId: channel.id, scheduledAt: `${DAY}T23:00:00+05:45` }),
      await call('POST', `${p}/jobs/${job.id}/reschedule`, {}),
      await call('POST', `${p}/jobs/${job.id}/reschedule`, { scheduledAt: 'tomorrow' }),
      await call('POST', `${p}/jobs/${job.id}/confirm-manual`, {}),
      await call('POST', `${p}/jobs/${job.id}/confirm-manual`, { url: 'not a link' }),
      await call('POST', `${p}/jobs/${job.id}/resolve-unknown`, { posted: 'yes' }),
      await call('POST', `${p}/jobs/${job.id}/resolve-unknown`, { posted: true }),
      await call('PUT', `${p}/settings`, { windowStart: 9, windowEnd: 9, maxAttempts: 3 }),
      await call('PUT', `${p}/settings`, { windowStart: 7, windowEnd: 21, maxAttempts: 9 }),
      await call('GET', `${p}/jobs?from=2026-12-01`),
      await call('GET', `${p}/jobs?from=2026-12-08T00:00:00Z&to=2026-12-01T00:00:00Z`),
      await call('GET', `${p}/jobs?from=2026-12-01T00:00:00Z&to=2027-03-01T00:00:00Z`),
      await call('GET', `${p}/jobs?state=lost`),
    ];
    for (const r of bad) expect(r).toMatchObject({ status: 400, body: { error: { code: 'validation', message: expect.any(String) } } });
  });

  it('runs a job through the screens\' calls: dashboard, calendar, detail with history, actions where allowed', async () => {
    const { brand, p, job, channel } = await brandWithJob();
    expect(job).toMatchObject({ state: 'scheduled', channel: { id: channel.id, platform: 'instagram', mode: 'manual' }, kind: 'static', actions: { cancel: true, reschedule: true, retry: false } });

    let s = (await call('GET', `${p}/summary`)).body;
    expect(s).toMatchObject({ timezone: 'Asia/Kathmandu', hasChannels: true, counts: { scheduled: 1, published: 0 }, manualNow: [], attention: [], published: [] });
    expect(s.upcoming.map((j: any) => j.id)).toEqual([job.id]);

    const week = (await call('GET', `${p}/jobs?from=${encodeURIComponent(`${DAY}T00:00:00+05:45`)}&to=${encodeURIComponent(`${DAY}T23:59:00+05:45`)}`)).body;
    expect(week).toMatchObject({ timezone: 'Asia/Kathmandu', jobs: [{ id: job.id }] });
    expect((await call('GET', `${p}/jobs?state=published`)).body.jobs).toEqual([]);

    // Its time comes on a manual channel: the scheduler would set awaiting_manual.
    await t.adminQuery(`update publish_jobs set state = 'awaiting_manual', attempts = 1 where id = $1`, [job.id]);
    s = (await call('GET', `${p}/summary`)).body;
    expect(s.manualNow.map((j: any) => j.id)).toEqual([job.id]);
    expect(s.manualNow[0].actions).toEqual({ cancel: true, reschedule: false, retry: false, confirmManual: true, resolveUnknown: false });

    expect((await call('POST', `${p}/jobs/${job.id}/retry`)).status).toBe(409);
    const done = await call('POST', `${p}/jobs/${job.id}/confirm-manual`, { url: 'https://instagram.com/p/abc' });
    expect(done).toMatchObject({ status: 200, body: { state: 'published', manual: true, externalUrl: 'https://instagram.com/p/abc' } });
    expect((await call('POST', `${p}/jobs/${job.id}/confirm-manual`, { url: 'https://instagram.com/p/xyz' })).status).toBe(409);

    const detail = (await call('GET', `${p}/jobs/${job.id}`)).body;
    expect(detail.history.map((h: any) => [h.action, h.from, h.to])).toEqual([
      ['publish.job.confirm_manual', 'awaiting_manual', 'published'],
      ['publish.job.schedule', null, 'scheduled'],
    ]);
    s = (await call('GET', `${p}/summary`)).body;
    expect(s.published.map((j: any) => j.externalUrl)).toEqual(['https://instagram.com/p/abc']);
    expect((await call('GET', `/brands/${brand}/publish/capabilities`)).body.find((c: any) => c.platform === 'x')).toEqual({
      platform: 'x', textLimit: 280, ratios: ['16:9', '1:1'], maxMedia: 4, lastVerified: null, verified: false, manualFallback: true,
    });
    expect((await call('POST', `${p}/channels`, { platform: 'instagram', accountName: '@shop' })).status).toBe(409);
  });

  it('a summary survives a brand with an invalid timezone', async () => {
    const brand = await t.makeBrand();
    await t.adminQuery(`update brands set timezone = 'Mars/Olympus' where id = $1`, [brand]);
    expect((await call('GET', `/brands/${brand}/publish/summary`)).body).toMatchObject({ timezone: 'UTC', hasChannels: false });
  });
});
