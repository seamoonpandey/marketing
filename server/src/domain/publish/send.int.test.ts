import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { launchTestWorkflows, testDb, type TestDb } from '../../../test/helpers.ts';
import { withBrand } from '../../db/tenant.ts';
import { startSend } from '../../workflows/publish-run.ts';
import { createChannel, updateChannel } from './channels.ts';
import { MockConnector, mockConnector } from './connectors/index.ts';
import { fakeReads } from './fake-reads.ts';
import { getJob } from './jobs.ts';
import { testReads, type DraftForPublish } from './reads.ts';
import { scheduleJob } from './schedule.ts';
import { dueJobs, sendJob } from './send.ts';

let t: TestDb;
let stop: () => Promise<void>;
beforeAll(async () => {
  t = await testDb();
  stop = await launchTestWorkflows(t);
});
afterAll(async () => {
  await stop();
  await t.close();
});

const fake = fakeReads();
const DAY = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
const AT = `${DAY}T10:00:00+05:45`;
const T0 = new Date(AT).getTime();
const min = (m: number) => new Date(T0 + m * 60_000);
let mock: MockConnector;
let slept: number[];
beforeEach(() => {
  mock = new MockConnector();
  slept = [];
});

async function setup(o: { brand?: string; platform?: string; connector?: 'manual' | 'mock'; draft?: DraftForPublish & { brandId: string } } = {}) {
  const brand = o.brand ?? (await t.makeBrand());
  const platform = o.platform ?? 'facebook';
  const channel = await withBrand(brand, (tx) => createChannel(tx, brand, { platform, accountName: `@${platform}`, connector: o.connector ?? 'mock' }));
  const draft = o.draft ?? fake.add(brand);
  const job = await withBrand(brand, (tx) => scheduleJob(tx, brand, { draftId: draft.id, channelId: channel.id, scheduledAt: AT }, [], fake.reads));
  return { brand, channel, draft, job, key: job.idempotencyKey };
}
/** Sends at T0 + minutes, with the fake gate, the test's mock and no real waiting. */
const send = (brand: string, id: string, minutes = 1) =>
  sendJob(brand, id, { reads: fake.reads, connector: mock, now: () => min(minutes), sleep: async (s) => void slept.push(s) });
const read = (brand: string, id: string) => withBrand(brand, (tx) => getJob(tx, brand, id));

describe('sending a job', () => {
  it("a manual channel's due job waits for the owner and the connector is never called", async () => {
    const { brand, job } = await setup({ connector: 'manual' });
    expect(await send(brand, job.id)).toMatchObject({ state: 'awaiting_manual', attempts: 1 });
    expect(mock.calls).toEqual([]);
  });

  it('publishes through the connector with the caption, hashtags and the media in the platform\'s shape', async () => {
    const draft = fake.add(await t.makeBrand(), { kind: 'carousel', renders: [
      { ratio: '16:9', key: 'a/0.png', width: 1, height: 1, sha256: 's', index: 0 },
      { ratio: '1:1', key: 'b/1.png', width: 1, height: 1, sha256: 's', index: 1 },
      { ratio: '1:1', key: 'b/0.png', width: 1, height: 1, sha256: 's', index: 0 },
    ] });
    const { brand, job, key } = await setup({ brand: draft.brandId, platform: 'instagram', draft });
    const done = await send(brand, job.id);
    expect(done).toMatchObject({ state: 'published', externalId: 'mock-1', externalUrl: 'https://mock.example/post/1', manual: false, error: null });
    expect(mock.calls).toEqual([{ idempotencyKey: key, req: {
      platform: 'instagram', accountName: '@instagram', caption: 'Warm pashmina shawls, woven in Kathmandu.\n\nVisit the shop', hashtags: ['#shawl'],
      media: [{ key: 'b/0.png', ratio: '1:1', kind: 'image' }, { key: 'b/1.png', ratio: '1:1', kind: 'image' }],
    } }]);
    const actions = (await t.adminQuery(`select action from audit_events where object_id = $1 order by seq`, [job.id])).map((r) => r.action);
    expect(actions).toEqual(['publish.job.schedule', 'publish.job.claim', 'publish.job.sent']);
  });

  it('blocks a job whose approval now carries a different hash, or none, and sends nothing (AT-013)', async () => {
    const a = await setup();
    fake.approvals.set(a.draft.id, { ...fake.approvals.get(a.draft.id)!, payloadHash: 'different' });
    expect(await send(a.brand, a.job.id)).toMatchObject({ state: 'blocked', error: expect.stringMatching(/changed or approved again/) });
    const b = await setup();
    fake.edit(b.draft.id);
    expect(await send(b.brand, b.job.id)).toMatchObject({ state: 'blocked', error: expect.stringMatching(/approval no longer stands/) });
    expect(mock.calls).toEqual([]);
  });

  it('a timeout leaves the job unknown while the platform cannot tell (AT-014)', async () => {
    const { brand, job, key } = await setup();
    mock.program(key, { result: 'timeout', posted: true }).programReconcile(key, { found: 'unknown' }, { found: 'unknown' }, { found: 'unknown' });
    expect(await send(brand, job.id)).toMatchObject({ state: 'unknown' });
    expect(slept).toEqual([60, 300, 900]);
    expect(mock.calls).toHaveLength(1);
  });

  it('a timeout whose post reconcile finds becomes published with exactly one publish call (AT-014)', async () => {
    const { brand, job, key } = await setup();
    mock.program(key, { result: 'timeout', posted: true });
    expect(await send(brand, job.id)).toMatchObject({ state: 'published', externalUrl: 'https://mock.example/post/1' });
    expect(slept).toEqual([60]);
    expect(mock.calls).toHaveLength(1);
  });

  it('a timeout whose post reconcile does not find is sent again with the same key, published after exactly two calls (AT-014)', async () => {
    const { brand, job, key } = await setup();
    mock.program(key, { result: 'timeout', posted: false });
    const back = await send(brand, job.id);
    expect(back).toMatchObject({ state: 'scheduled', attempts: 1 });
    expect(back.nextAttemptAt!.getTime()).toBe(min(1).getTime());
    expect(await send(brand, job.id, 2)).toMatchObject({ state: 'published', attempts: 2 });
    expect(mock.calls.map((c) => c.idempotencyKey)).toEqual([key, key]);
    expect(mock.posts.size).toBe(1);
  });

  it('one draft on two channels, one failing for a missing permission, ends one published and one failed (AT-015)', async () => {
    const fb = await setup({ platform: 'facebook' });
    const ig = await setup({ brand: fb.brand, platform: 'instagram', draft: fb.draft });
    mock.program(ig.key, { result: 'error', kind: 'scope' });
    await Promise.all([send(fb.brand, fb.job.id), send(ig.brand, ig.job.id)]);
    expect(await read(fb.brand, fb.job.id)).toMatchObject({ state: 'published' });
    expect(await read(ig.brand, ig.job.id)).toMatchObject({ state: 'failed', retryable: false, error: expect.stringMatching(/by hand/) });
  });

  it('two concurrent sends of one job make exactly one connector call', async () => {
    const { brand, job } = await setup();
    const results = await Promise.all([send(brand, job.id), send(brand, job.id), send(brand, job.id)]);
    expect(mock.calls).toHaveLength(1);
    expect(results.filter((r) => r.state === 'published').length).toBeGreaterThanOrEqual(1);
    expect(await read(brand, job.id)).toMatchObject({ state: 'published', attempts: 1 });
  });

  it('a send repeated after a crash makes no second post: the key is the same', async () => {
    const { brand, job, key } = await setup();
    // A worker sent it and died before recording the answer.
    const first = await mock.publish({ platform: 'facebook', accountName: '@facebook', caption: '', hashtags: [], media: [] }, key);
    expect(await send(brand, job.id)).toMatchObject({ state: 'published', externalUrl: first.status === 'published' ? first.url : '' });
    expect(mock.posts.size).toBe(1);
  });

  it('a rate limit of 120 seconds moves the job 120 seconds ahead, and it is not due or sent before then', async () => {
    const { brand, job, key } = await setup();
    mock.program(key, { result: 'error', kind: 'rate_limited', retryAfterSeconds: 120 });
    const after = await send(brand, job.id, 1);
    expect(after).toMatchObject({ state: 'scheduled', attempts: 1 });
    expect(after.nextAttemptAt!.getTime()).toBe(min(1).getTime() + 120_000);
    const due = async (at: Date) => (await dueJobs(at)).some((d) => d.jobId === job.id);
    expect(await due(new Date(min(1).getTime() + 119_000))).toBe(false);
    expect(await due(new Date(min(1).getTime() + 120_000))).toBe(true);
    expect(await send(brand, job.id, 2)).toMatchObject({ state: 'scheduled' }); // not due yet: not claimed
    expect(mock.calls).toHaveLength(1);
    expect(await send(brand, job.id, 3)).toMatchObject({ state: 'published', attempts: 2 });
  });

  it('a server error is retried with a growing delay, then fails retryable at the attempt limit', async () => {
    const { brand, job, key } = await setup();
    mock.program(key, ...Array(3).fill({ result: 'error', kind: 'server' }));
    expect((await send(brand, job.id, 1)).nextAttemptAt!.getTime()).toBe(min(1).getTime() + 120_000);
    expect((await send(brand, job.id, 4)).nextAttemptAt!.getTime()).toBe(min(4).getTime() + 240_000);
    expect(await send(brand, job.id, 9)).toMatchObject({ state: 'failed', retryable: true, attempts: 3 });
  });

  it('a 401 blocks the job and marks the channel for reconnecting', async () => {
    const { brand, channel, job, key } = await setup();
    mock.program(key, { result: 'error', kind: 'auth' });
    expect(await send(brand, job.id)).toMatchObject({ state: 'blocked' });
    expect((await t.adminQuery(`select status from channels where id = $1`, [channel.id]))[0].status).toBe('needs_reconnect');
  });

  it('a job 30 minutes late is sent once; a job 25 hours late is blocked as missed (review focus 2)', async () => {
    const late = await setup();
    expect(await send(late.brand, late.job.id, 30)).toMatchObject({ state: 'published' });
    expect(await send(late.brand, late.job.id, 31)).toMatchObject({ state: 'published' });
    expect(mock.calls).toHaveLength(1);
    const missed = await setup();
    expect(await send(missed.brand, missed.job.id, 25 * 60)).toMatchObject({ state: 'blocked', error: 'missed its time' });
    expect(mock.calls).toHaveLength(1);
  });

  it('a job whose channel is disabled or removed at send time is blocked, and nothing is sent (review focus 3)', async () => {
    const off = await setup();
    await withBrand(off.brand, (tx) => updateChannel(tx, off.brand, off.channel.id, { status: 'disabled' }));
    expect(await send(off.brand, off.job.id)).toMatchObject({ state: 'blocked', error: 'The channel is disabled' });
    const gone = await setup();
    await t.adminQuery(`delete from channels where id = $1`, [gone.channel.id]);
    expect(await send(gone.brand, gone.job.id)).toMatchObject({ state: 'blocked', error: 'The channel was removed' });
    expect(mock.calls).toEqual([]);
  });
});

describe('the scheduler', () => {
  it('starts each due job once through the workflow, whatever the brand\'s timezone', async () => {
    testReads.current = fake.reads;
    try {
      mockConnector.reset();
      const a = await setup();
      const b = await setup();
      await t.adminQuery(`update brands set timezone = 'Mars/Olympus' where id = $1`, [b.brand]);
      await t.adminQuery(`update publish_jobs set scheduled_at = now() - interval '5 minutes' where id in ($1, $2)`, [a.job.id, b.job.id]);
      const due = (await dueJobs(new Date())).filter((d) => d.jobId === a.job.id || d.jobId === b.job.id);
      expect(due).toHaveLength(2);
      for (const d of due) await (await startSend(d)).getResult();
      // Dispatched again in the same attempt: the same workflow ID, so no second run.
      for (const d of due) await (await startSend(d)).getResult();
      expect(await read(a.brand, a.job.id)).toMatchObject({ state: 'published', attempts: 1 });
      expect(await read(b.brand, b.job.id)).toMatchObject({ state: 'published', attempts: 1 });
      expect(mockConnector.calls).toHaveLength(2);
      expect((await dueJobs(new Date())).filter((d) => d.jobId === a.job.id)).toEqual([]);
    } finally {
      delete testReads.current;
    }
  });
});
