import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDb, type TestDb } from '../../../test/helpers.ts';
import { withBrand } from '../../db/tenant.ts';
import { createChannel, updateChannel } from './channels.ts';
import { fakeReads } from './fake-reads.ts';
import { getJob } from './jobs.ts';
import { confirmManual, resolveUnknown, retryJob } from './manual.ts';
import { scheduleJob } from './schedule.ts';

let t: TestDb;
beforeAll(async () => {
  t = await testDb();
});
afterAll(() => t.close());

const fake = fakeReads();
const DAY = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);

/** A scheduled job, then put in `state` as the send path would have left it. */
async function jobIn(state: string, o: { retryable?: boolean } = {}) {
  const brand = await t.makeBrand();
  const channel = await withBrand(brand, (tx) => createChannel(tx, brand, { platform: 'facebook', accountName: '@brand' }));
  const d = fake.add(brand);
  const job = await withBrand(brand, (tx) => scheduleJob(tx, brand, { draftId: d.id, channelId: channel.id, scheduledAt: `${DAY}T10:00:00+05:45` }, [], fake.reads));
  await t.adminQuery(`update publish_jobs set state = $2, retryable = $3, attempts = 1 where id = $1`, [job.id, state, o.retryable ?? false]);
  return { brand, channel, draft: d, job };
}
const read = (brand: string, id: string) => withBrand(brand, (tx) => getJob(tx, brand, id));
const events = (id: string) => t.adminQuery(`select action, reason from audit_events where object_id = $1 order by seq`, [id]);

describe('manual posting', () => {
  it('refuses a link that is not a URL, accepts an https URL as published by hand, and a second confirmation changes nothing (review focus 4)', async () => {
    const { brand, job } = await jobIn('awaiting_manual');
    await expect(withBrand(brand, (tx) => confirmManual(tx, brand, job.id, 'not a link'))).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/not a URL/) });
    await expect(withBrand(brand, (tx) => confirmManual(tx, brand, job.id, 'javascript:alert(1)'))).rejects.toMatchObject({ status: 400 });
    expect((await read(brand, job.id)).state).toBe('awaiting_manual');

    const done = await withBrand(brand, (tx) => confirmManual(tx, brand, job.id, 'https://facebook.com/brand/posts/1'));
    expect(done).toMatchObject({ state: 'published', manual: true, externalUrl: 'https://facebook.com/brand/posts/1', externalId: null });
    expect(done.publishedAt).toBeInstanceOf(Date);

    await expect(withBrand(brand, (tx) => confirmManual(tx, brand, job.id, 'https://facebook.com/brand/posts/2'))).rejects.toMatchObject({ status: 409 });
    expect(await read(brand, job.id)).toEqual(done);
    const ev = await events(job.id);
    expect(ev.map((e) => e.action)).toEqual(['publish.job.schedule', 'publish.job.confirm_manual']);
    expect(JSON.parse(ev[1].reason)).toMatchObject({ from: 'awaiting_manual', to: 'published', hash: job.payloadHash });
  });

  it('two confirmations at once publish once', async () => {
    const { brand, job } = await jobIn('awaiting_manual');
    const r = await Promise.allSettled(['https://p/1', 'https://p/2'].map((u) => withBrand(brand, (tx) => confirmManual(tx, brand, job.id, u))));
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect((await events(job.id)).filter((e) => e.action === 'publish.job.confirm_manual')).toHaveLength(1);
  });

  it("refuses another brand's job with 404", async () => {
    const { job } = await jobIn('awaiting_manual');
    const other = await t.makeBrand();
    await expect(withBrand(other, (tx) => confirmManual(tx, other, job.id, 'https://p/1'))).rejects.toMatchObject({ status: 404 });
  });
});

describe('resolving an unknown job, and retry', () => {
  it('posted: false returns the job to scheduled, due now, with the same idempotency key', async () => {
    const { brand, job } = await jobIn('unknown');
    const before = Date.now();
    const back = await withBrand(brand, (tx) => resolveUnknown(tx, brand, job.id, { posted: false }));
    expect(back).toMatchObject({ state: 'scheduled', idempotencyKey: job.idempotencyKey });
    expect(back.nextAttemptAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  it('posted: true needs a link, then sets published', async () => {
    const { brand, job } = await jobIn('unknown');
    await expect(withBrand(brand, (tx) => resolveUnknown(tx, brand, job.id, { posted: true }))).rejects.toMatchObject({ status: 400 });
    await expect(withBrand(brand, (tx) => resolveUnknown(tx, brand, job.id, { posted: true, url: 'nope' }))).rejects.toMatchObject({ status: 400 });
    expect(await withBrand(brand, (tx) => resolveUnknown(tx, brand, job.id, { posted: true, url: 'https://p/9' })))
      .toMatchObject({ state: 'published', externalUrl: 'https://p/9', manual: false });
    await expect(withBrand(brand, (tx) => resolveUnknown(tx, brand, job.id, { posted: false }))).rejects.toMatchObject({ status: 409 });
  });

  it('retry is refused on an unknown job', async () => {
    const { brand, job } = await jobIn('unknown');
    await expect(withBrand(brand, (tx) => retryJob(tx, brand, job.id, fake.reads))).rejects.toThrow(/may have been posted/);
    expect((await read(brand, job.id)).state).toBe('unknown');
  });

  it('retry from blocked or a retryable failure re-runs the gate, the channel check, and schedules it now', async () => {
    const blocked = await jobIn('blocked');
    expect(await withBrand(blocked.brand, (tx) => retryJob(tx, blocked.brand, blocked.job.id, fake.reads))).toMatchObject({ state: 'scheduled', idempotencyKey: blocked.job.idempotencyKey });

    const failed = await jobIn('failed', { retryable: true });
    await withBrand(failed.brand, (tx) => updateChannel(tx, failed.brand, failed.channel.id, { status: 'disabled' }));
    await expect(withBrand(failed.brand, (tx) => retryJob(tx, failed.brand, failed.job.id, fake.reads))).rejects.toThrow(/disabled/);
    await withBrand(failed.brand, (tx) => updateChannel(tx, failed.brand, failed.channel.id, { status: 'connected' }));
    fake.edit(failed.draft.id); // the draft changed: no approval stands
    await expect(withBrand(failed.brand, (tx) => retryJob(tx, failed.brand, failed.job.id, fake.reads))).rejects.toThrow(/no valid approval/);
    fake.approvals.set(failed.draft.id, { id: 'a2', objectId: failed.draft.id, objectVersion: 2, payloadHash: 'new', expiresAt: new Date(Date.now() + 86_400_000) });
    await expect(withBrand(failed.brand, (tx) => retryJob(tx, failed.brand, failed.job.id, fake.reads))).rejects.toThrow(/approved again/);
    expect((await read(failed.brand, failed.job.id)).state).toBe('failed');

    const final = await jobIn('failed', { retryable: false });
    await expect(withBrand(final.brand, (tx) => retryJob(tx, final.brand, final.job.id, fake.reads))).rejects.toThrow(/cannot be retried/);
  });
});
