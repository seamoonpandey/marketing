import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDb, type TestDb } from '../../../test/helpers.ts';
import { withBrand } from '../../db/tenant.ts';
import { createChannel, updateChannel } from './channels.ts';
import { fakeReads } from './fake-reads.ts';
import { cancelJob, offsetAt, parseAt, rescheduleJob, scheduleJob } from './schedule.ts';
import { setSettings } from './settings.ts';

let t: TestDb;
beforeAll(async () => {
  t = await testDb();
});
afterAll(() => t.close());

const fake = fakeReads();
const DAY = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10); // two days ahead, in any timezone
const at = (hhmm: string, offset = '+05:45') => `${DAY}T${hhmm}:00${offset}`;

async function setup(platform = 'facebook') {
  const brand = await t.makeBrand();
  const channel = await withBrand(brand, (tx) => createChannel(tx, brand, { platform, accountName: '@brand' }));
  return { brand, channel };
}
const schedule = (brand: string, i: { draftId: string; channelId: string; scheduledAt: string }) => withBrand(brand, (tx) => scheduleJob(tx, brand, i, [], fake.reads));

describe('scheduling', () => {
  it('refuses a draft without a valid approval; with one it stores the version, the hash and a new idempotency key', async () => {
    const { brand, channel } = await setup();
    const unapproved = fake.add(brand, {}, null);
    await expect(schedule(brand, { draftId: unapproved.id, channelId: channel.id, scheduledAt: at('10:00') })).rejects.toThrow(/no valid approval/);

    const d = fake.add(brand, { currentVersion: 3 });
    const job = await schedule(brand, { draftId: d.id, channelId: channel.id, scheduledAt: at('10:00') });
    expect(job).toMatchObject({ state: 'scheduled', draftVersion: 3, payloadHash: `hash-${d.id}-v3`, attempts: 0, channelId: channel.id });
    expect(job.scheduledAt.toISOString()).toBe(new Date(at('10:00')).toISOString());
    expect(job.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    const [ev] = await t.adminQuery(`select action, object_version, reason from audit_events where object_id = $1`, [job.id]);
    expect(ev).toMatchObject({ action: 'publish.job.schedule', object_version: 3 });
    expect(JSON.parse(ev.reason)).toEqual({ from: null, to: 'scheduled', hash: `hash-${d.id}-v3` });
  });

  it('refuses a time with no offset, at 23:00 brand time under the default hours, and in the past (review focus 1)', async () => {
    const { brand, channel } = await setup();
    const d = fake.add(brand);
    const s = (scheduledAt: string) => schedule(brand, { draftId: d.id, channelId: channel.id, scheduledAt });
    await expect(s('2026-12-01T10:00')).rejects.toThrow(/needs a date, a time and an offset/);
    await expect(s(`${DAY}T10:00:00`)).rejects.toThrow(/offset/);
    await expect(s(at('23:00'))).rejects.toThrow(/23:00 Asia\/Kathmandu is outside the publishing hours, 7:00 to 21:00/);
    await expect(s(at('21:00'))).rejects.toThrow(/outside the publishing hours/);
    await expect(s(at('06:59'))).rejects.toThrow(/outside the publishing hours/);
    await expect(s('2020-01-01T10:00:00+05:45')).rejects.toThrow(/in the past/);
    await expect(s(`${DAY}T10:00:00+05:30`)).rejects.toThrow(/does not exist in Asia\/Kathmandu/);
    await expect(s('2027-02-30T10:00:00+05:45')).rejects.toThrow(/not a real date/);
    // 23:00 in Kathmandu is 17:15 UTC: the window is checked in the brand's time, not UTC.
    await expect(s(`${DAY}T17:15:00Z`)).rejects.toThrow(/outside the publishing hours/);
    const ok = await s(`${DAY}T04:15:00Z`); // 10:00 in Kathmandu
    expect(ok.scheduledAt.toISOString()).toBe(`${DAY}T04:15:00.000Z`);
  });

  it('refuses a wall-clock time inside a daylight-saving gap, and accepts the real one (review focus 1)', async () => {
    const { brand, channel } = await setup();
    await t.adminQuery(`update brands set timezone = 'Europe/London' where id = $1`, [brand]);
    await withBrand(brand, (tx) => setSettings(tx, brand, { windowStart: 0, windowEnd: 24, maxAttempts: 3 }));
    // London springs forward at 01:00 UTC on 28 March 2027: 01:30 that night never happens.
    expect(offsetAt('Europe/London', new Date('2027-03-28T01:30:00Z'))).toBe(60);
    expect(() => parseAt('2027-03-28T01:30:00+00:00', 'Europe/London')).toThrow(/daylight-saving/);
    const d = fake.add(brand, {}, { expiresAt: new Date('2027-12-31T00:00:00Z') });
    await expect(schedule(brand, { draftId: d.id, channelId: channel.id, scheduledAt: '2027-03-28T01:30:00+00:00' })).rejects.toThrow(/does not exist in Europe\/London/);
    const job = await schedule(brand, { draftId: d.id, channelId: channel.id, scheduledAt: '2027-03-28T02:30:00+01:00' });
    expect(job.scheduledAt.toISOString()).toBe('2027-03-28T01:30:00.000Z');
  });

  it('refuses scheduling for a brand whose timezone is not valid, with a clear message', async () => {
    const { brand, channel } = await setup();
    await t.adminQuery(`update brands set timezone = 'Mars/Olympus' where id = $1`, [brand]);
    const d = fake.add(brand);
    await expect(schedule(brand, { draftId: d.id, channelId: channel.id, scheduledAt: `${DAY}T04:15:00Z` })).rejects.toThrow(/timezone "Mars\/Olympus" is not valid/);
  });

  it('refuses a second job for one draft and channel while the first is scheduled, and accepts it after cancelling (review focus 5)', async () => {
    const { brand, channel } = await setup();
    const d = fake.add(brand);
    const i = { draftId: d.id, channelId: channel.id, scheduledAt: at('10:00') };
    const first = await schedule(brand, i);
    await expect(schedule(brand, { ...i, scheduledAt: at('11:00') })).rejects.toThrow(/already has an active job/);
    // Two at once: the database stores one.
    await withBrand(brand, (tx) => cancelJob(tx, brand, first.id));
    const raced = await Promise.allSettled([schedule(brand, i), schedule(brand, i)]);
    expect(raced.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await t.adminQuery(`select state from publish_jobs where draft_id = $1 order by created_at`, [d.id])).map((r) => r.state)).toEqual(['cancelled', 'scheduled']);
    // Another channel is another job.
    const other = await withBrand(brand, (tx) => createChannel(tx, brand, { platform: 'instagram', accountName: '@brand' }));
    expect((await schedule(brand, { ...i, channelId: other.id })).state).toBe('scheduled');
  });

  it('refuses a channel that is not connected, a draft that does not fit, an approval that expires first, and another brand\'s channel', async () => {
    const { brand, channel } = await setup('x');
    const d = fake.add(brand);
    await withBrand(brand, (tx) => updateChannel(tx, brand, channel.id, { status: 'disabled' }));
    await expect(schedule(brand, { draftId: d.id, channelId: channel.id, scheduledAt: at('10:00') })).rejects.toThrow(/channel is disabled/);
    await withBrand(brand, (tx) => updateChannel(tx, brand, channel.id, { status: 'connected' }));

    const long = fake.add(brand, { content: { copies: [{ language: 'en', sentences: [{ text: 'a'.repeat(300) }], hashtags: [], cta: '' }] } });
    await expect(schedule(brand, { draftId: long.id, channelId: channel.id, scheduledAt: at('10:00') })).rejects.toThrow(/x takes at most 280/);

    const soon = fake.add(brand, {}, { expiresAt: new Date(Date.now() + 3600_000) });
    await expect(schedule(brand, { draftId: soon.id, channelId: channel.id, scheduledAt: at('10:00') })).rejects.toThrow(/approval expires/);

    const other = await setup();
    await expect(schedule(brand, { draftId: d.id, channelId: other.channel.id, scheduledAt: at('10:00') })).rejects.toMatchObject({ status: 404 });
    await expect(schedule(other.brand, { draftId: d.id, channelId: other.channel.id, scheduledAt: at('10:00') })).rejects.toMatchObject({ status: 404 });
    expect(await t.adminQuery(`select 1 from publish_jobs where brand_id in ($1, $2)`, [brand, other.brand])).toEqual([]);
  });

  it('moves a scheduled job with the same checks, and refuses moving it once it is published or its approval changed', async () => {
    const { brand, channel } = await setup();
    const d = fake.add(brand);
    const job = await schedule(brand, { draftId: d.id, channelId: channel.id, scheduledAt: at('10:00') });
    const moved = await withBrand(brand, (tx) => rescheduleJob(tx, brand, job.id, at('12:30'), fake.reads));
    expect(moved.scheduledAt.toISOString()).toBe(new Date(at('12:30')).toISOString());
    await expect(withBrand(brand, (tx) => rescheduleJob(tx, brand, job.id, at('22:00'), fake.reads))).rejects.toThrow(/outside the publishing hours/);
    fake.approvals.set(d.id, { ...fake.approvals.get(d.id)!, payloadHash: 'approved-again' });
    await expect(withBrand(brand, (tx) => rescheduleJob(tx, brand, job.id, at('13:00'), fake.reads))).rejects.toThrow(/approved again/);
    await t.adminQuery(`update publish_jobs set state = 'published' where id = $1`, [job.id]);
    await expect(withBrand(brand, (tx) => rescheduleJob(tx, brand, job.id, at('13:00'), fake.reads))).rejects.toThrow(/published job cannot be moved/);
    await expect(withBrand(brand, (tx) => cancelJob(tx, brand, job.id))).rejects.toThrow(/published job cannot be cancelled/);
  });
});
