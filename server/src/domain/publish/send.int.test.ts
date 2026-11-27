import { DBOS } from '@dbos-inc/dbos-sdk';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { launchTestWorkflows, testDb, type TestDb } from '../../../test/helpers.ts';
import { withBrand } from '../../db/tenant.ts';
import { publishTick, startSend } from '../../workflows/publish-run.ts';
import { createChannel, updateChannel } from './channels.ts';
import { ConnectorError, MockConnector, mockConnector, type Connector } from './connectors/index.ts';
import { fakeReads } from './fake-reads.ts';
import { getJob } from './jobs.ts';
import { testReads, type DraftForPublish } from './reads.ts';
import { scheduleJob } from './schedule.ts';
import { dueJobs, reconcileJob, sendJob, sweepStalled } from './send.ts';

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

async function setup(o: { brand?: string; platform?: string; connector?: 'manual' | 'mock'; draft?: DraftForPublish & { brandId: string }; at?: string } = {}) {
  const brand = o.brand ?? (await t.makeBrand());
  const platform = o.platform ?? 'facebook';
  const channel = await withBrand(brand, (tx) => createChannel(tx, brand, { platform, accountName: `@${platform}`, connector: o.connector ?? 'mock' }));
  const draft = o.draft ?? fake.add(brand);
  const job = await withBrand(brand, (tx) => scheduleJob(tx, brand, { draftId: draft.id, channelId: channel.id, scheduledAt: o.at ?? AT }, [], fake.reads));
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

describe('a retry outside the publishing hours', () => {
  it('waits for the start of the next window in the brand\'s timezone, and the wait is not an attempt', async () => {
    const { brand, job, key } = await setup();
    mock.program(key, { result: 'error', kind: 'rate_limited', retryAfterSeconds: 120 });
    // Sent late, at 20:58 Kathmandu time: the retry falls due at 21:00, where the window ends.
    expect((await send(brand, job.id, 658)).nextAttemptAt!.getTime()).toBe(min(660).getTime());
    const held = await send(brand, job.id, 660);
    expect(held).toMatchObject({ state: 'scheduled', attempts: 1 });
    expect(held.nextAttemptAt!.getTime()).toBe(min(21 * 60).getTime()); // 07:00 the next day, Kathmandu time
    expect(mock.calls).toHaveLength(1);
    expect(await send(brand, job.id, 21 * 60)).toMatchObject({ state: 'published', attempts: 2 });
  });

  it('leaves a job at its first scheduled time alone: it was checked when it was scheduled', async () => {
    const { brand, job } = await setup({ at: `${DAY}T20:59:00+05:45` });
    expect(await send(brand, job.id, 661)).toMatchObject({ state: 'published', attempts: 1 }); // 21:01, a minute late
  });

  it('uses UTC for a brand whose timezone is not valid, and still sends', async () => {
    const { brand, job, key } = await setup();
    await t.adminQuery(`update brands set timezone = 'Mars/Olympus' where id = $1`, [brand]);
    mock.program(key, { result: 'error', kind: 'server' });
    await send(brand, job.id, 1); // 04:16 UTC: the retry falls due before 07:00 UTC
    const held = await send(brand, job.id, 5);
    expect(held.nextAttemptAt!.toISOString()).toBe(`${DAY}T07:00:00.000Z`);
    expect(await send(brand, job.id, 165)).toMatchObject({ state: 'published', attempts: 2 });
  });
});

describe('a send that never finished', () => {
  /** A job claimed `minutes` ago by a send workflow that then died. */
  async function stuck(minutes: number) {
    const s = await setup();
    await t.adminQuery(`update publish_jobs set state = 'publishing', attempts = 1, workflow_id = 'dead', claimed_at = now() - make_interval(mins => $2) where id = $1`, [s.job.id, minutes]);
    return s;
  }
  const reconcile = (brand: string, id: string) => reconcileJob(brand, id, { connector: mock, now: () => min(20), sleep: async (s) => void slept.push(s) });

  it('becomes unknown after 15 minutes publishing, is never sent from there, and a younger one is left alone', async () => {
    const old = await stuck(16);
    const young = await stuck(10);
    const swept = (await sweepStalled(new Date())).map((s) => s.jobId);
    expect(swept).toContain(old.job.id);
    expect(swept).not.toContain(young.job.id);
    expect(await read(old.brand, old.job.id)).toMatchObject({ state: 'unknown', error: 'the send did not finish', attempts: 1 });
    expect(await read(young.brand, young.job.id)).toMatchObject({ state: 'publishing' });
    expect(await send(old.brand, old.job.id)).toMatchObject({ state: 'unknown' });
    expect(mock.calls).toEqual([]);
  });

  it('then goes through reconcile: found is published with no send; not found is sent once more with the same key', async () => {
    const found = await stuck(16);
    const lost = await stuck(16);
    await mock.publish({ platform: 'facebook', accountName: '@facebook', caption: '', hashtags: [], media: [] }, found.key); // the dead send did post
    mock.calls.length = 0;
    await sweepStalled(new Date());
    expect(await reconcile(found.brand, found.job.id)).toMatchObject({ state: 'published', externalUrl: 'https://mock.example/post/1' });
    expect(await reconcile(lost.brand, lost.job.id)).toMatchObject({ state: 'scheduled', attempts: 1 });
    expect(slept).toEqual([60, 60]);
    expect(await send(lost.brand, lost.job.id, 21)).toMatchObject({ state: 'published', attempts: 2 });
    expect(mock.calls.map((c) => c.idempotencyKey)).toEqual([lost.key]);
  });

  it('a send whose workflow fails after the connector answered is left publishing, then swept and reconciled, never sent twice', async () => {
    const { brand, job } = await setup();
    let reads = 0; // the clock is read by the claim, the missed check, then the apply after the send: that one fails
    const now = () => {
      if (++reads === 3) throw new Error('database gone');
      return min(1);
    };
    await expect(sendJob(brand, job.id, { reads: fake.reads, connector: mock, now })).rejects.toThrow('database gone');
    expect(await read(brand, job.id)).toMatchObject({ state: 'publishing' });
    expect((await sweepStalled(min(17))).map((s) => s.jobId)).toContain(job.id);
    expect(await reconcile(brand, job.id)).toMatchObject({ state: 'published', externalUrl: 'https://mock.example/post/1' });
    expect(mock.calls).toHaveLength(1);
  });

  it('the every-minute check sweeps it and starts its reconcile, once', async () => {
    const { brand, job, key } = await stuck(16);
    await publishTick();
    await publishTick();
    expect(await read(brand, job.id)).toMatchObject({ state: 'unknown' });
    const runs = await DBOS.listWorkflows({ workflowIDs: [`publish-reconcile:${key}:1`] });
    expect(runs).toHaveLength(1);
    await DBOS.cancelWorkflow(runs[0]!.workflowID);
  });
});

describe('a send held up between its checks and the connector', () => {
  /** Holds every read of the channels table, which a send makes after claiming the job, until release (or the test ends). */
  let held = false;
  async function holdChannels() {
    await t.adminQuery('begin');
    await t.adminQuery('lock table channels in access exclusive mode');
    held = true;
    return release;
  }
  async function release() {
    if (held) await t.adminQuery('commit');
    held = false;
  }
  const waitingOnLock = (n: number) =>
    vi.waitFor(async () => expect((await t.adminQuery(`select 1 from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`)).length).toBeGreaterThanOrEqual(n), { timeout: 10_000, interval: 50 });
  const settled = (brand: string, id: string) =>
    vi.waitFor(async () => expect((await read(brand, id)).state).not.toBe('publishing'), { timeout: 10_000, interval: 50 });
  async function dueNow() {
    const s = await setup();
    await t.adminQuery(`update publish_jobs set scheduled_at = now() - interval '5 minutes' where id = $1`, [s.job.id]);
    const [d] = (await dueJobs(new Date())).filter((x) => x.jobId === s.job.id);
    return { ...s, due: d! };
  }

  it('a resumed workflow never sends on the gate answer it replays, nor beside a first run still going', async () => {
    testReads.current = fake.reads;
    mockConnector.reset();
    try {
      const a = await dueNow();
      const release = await holdChannels();
      await startSend(a.due);
      await waitingOnLock(1);
      fake.edit(a.draft.id); // the owner edits the draft meanwhile: no approval stands
      // Another process starts and resumes the workflow from its stored steps while the first run is still going.
      await DBOS.recoverWorkflows(['local']);
      await waitingOnLock(2);
      await release();
      await settled(a.brand, a.job.id);
      expect(mockConnector.calls).toEqual([]);
      expect(['scheduled', 'blocked']).toContain((await read(a.brand, a.job.id)).state);
    } finally {
      await release();
      delete testReads.current;
    }
  });

  it('asks the gate right before sending: an approval withdrawn while the send was held sends nothing', async () => {
    testReads.current = fake.reads;
    mockConnector.reset();
    try {
      const a = await dueNow();
      await holdChannels();
      const h = await startSend(a.due);
      await waitingOnLock(1);
      fake.edit(a.draft.id);
      await release();
      await h.getResult();
      expect(await read(a.brand, a.job.id)).toMatchObject({ state: 'blocked', error: expect.stringMatching(/approval no longer stands/) });
      expect(mockConnector.calls).toEqual([]);
    } finally {
      await release();
      delete testReads.current;
    }
  });

  it('a workflow resumed while its first run is still inside the connector does not send beside it', async () => {
    testReads.current = fake.reads;
    mockConnector.reset();
    let letGo!: () => void;
    const inFlight = new Promise<void>((r) => (letGo = r));
    const publish = mockConnector.publish.bind(mockConnector);
    mockConnector.publish = async (req, key) => {
      const r = publish(req, key); // recorded at once, answered when let go
      await inFlight;
      return r;
    };
    try {
      const a = await dueNow();
      const h = await startSend(a.due);
      await vi.waitFor(() => expect(mockConnector.calls).toHaveLength(1), { timeout: 10_000, interval: 50 });
      await DBOS.recoverWorkflows(['local']); // another process starts and resumes it
      await vi.waitFor(async () => {
        if (mockConnector.calls.length < 2) expect((await DBOS.getWorkflowStatus(h.workflowID))?.status).toBe('SUCCESS');
      }, { timeout: 10_000, interval: 50 });
      expect(mockConnector.calls).toHaveLength(1);
    } finally {
      letGo();
      delete (mockConnector as { publish?: unknown }).publish;
      delete testReads.current;
    }
  });

  it('never reaches the connector once the sweep has made the job unknown', async () => {
    testReads.current = fake.reads;
    mockConnector.reset();
    try {
      const a = await dueNow();
      const release = await holdChannels();
      const h = await startSend(a.due);
      await waitingOnLock(1);
      expect((await sweepStalled(new Date(Date.now() + 16 * 60_000))).map((s) => s.jobId)).toContain(a.job.id); // 16 minutes on
      await release();
      await h.getResult();
      expect(await read(a.brand, a.job.id)).toMatchObject({ state: 'unknown' });
      expect(mockConnector.calls).toEqual([]);
    } finally {
      await release();
      delete testReads.current;
    }
  });
});

describe('the post link a connector answers', () => {
  it('is stored only when it is a plain http or https URL, on a send and on a reconcile', async () => {
    const bad: Connector = {
      id: 'mock', validateCredentials: async () => true, healthCheck: async () => true, listCapabilities: mock.listCapabilities,
      publish: async () => ({ status: 'published', externalId: 'x1', url: 'javascript:alert(1)' }),
      reconcile: async () => ({ found: true, externalId: 'x2', url: 'javascript:alert(2)' }),
    };
    const a = await setup();
    expect(await sendJob(a.brand, a.job.id, { reads: fake.reads, connector: bad, now: () => min(1) })).toMatchObject({ state: 'published', externalId: 'x1', externalUrl: null });
    const b = await setup();
    const timesOut: Connector = { ...bad, publish: async () => { throw new ConnectorError('timeout'); } };
    expect(await sendJob(b.brand, b.job.id, { reads: fake.reads, connector: timesOut, now: () => min(1), sleep: async () => {} }))
      .toMatchObject({ state: 'published', externalId: 'x2', externalUrl: null });
  });
});
