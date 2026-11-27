// One post from an approved fact to the owner's manual package and to a connector, through the real Brand, Plan,
// Studio, Approve and Publish modules: no fake reads. Then each upstream change after scheduling must stop the post.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fakeRenderer, studioBrand } from '../test/fixtures/studio/setup.ts';
import { launchTestWorkflows, testDb, type TestDb } from '../test/helpers.ts';
import { mockAi } from './ai/index.ts';
import { createApp } from './app.ts';
import { withBrand } from './db/tenant.ts';
import { MockConnector } from './domain/publish/connectors/index.ts';
import { createChannel, dueJobs, sendJob } from './domain/publish/index.ts';
import { reads } from './domain/publish/reads.ts';
import { studioReads } from './domain/approve/studio.ts';
import { getRun, startGenerate, startRender } from './domain/studio/runs.ts';
import { listDrafts, markReady } from './domain/studio/drafts.ts';
import { putObject } from './storage/index.ts';

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
afterEach(() => mockAi.reset());

const app = createApp();
const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(`/api${path}`, {
    method, headers: body !== undefined ? { 'content-type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as any };
};
const AT = `${new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10)}T10:00:00+05:45`;
const wait = async (brand: string, runId: string) => {
  for (let i = 0; i < 400; i++) {
    const run = await withBrand(brand, (tx) => getRun(tx, brand, runId));
    if (run.state !== 'running') return run;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('run did not finish');
};

/** A fact approved, a week item citing it, its draft written, rendered, ready, approved, and scheduled on a channel. */
async function scheduledPost(o: { logo?: boolean } = {}) {
  const s = await studioBrand(t, { formats: ['image'] });
  const p = `/brands/${s.brand}`;
  let logoId: string | undefined;
  if (o.logo) {
    const [src] = await t.adminQuery(
      `insert into sources (tenant_id, brand_id, kind, uri, mime, checksum, object_key, trust, meta)
       values ($1, $2, 'upload', 'upload:logo', 'image/png', 'c', 'pending', 'owner', '{"status":"ready","filename":"logo.png"}') returning id`,
      [t.tenantId, s.brand],
    );
    const key = `tenant/${t.tenantId}/brand/${s.brand}/upload/${src.id}.png`;
    await t.adminQuery(`update sources set object_key = $1 where id = $2`, [key, src.id]);
    await putObject(key, new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 'image/png');
    logoId = (await call('POST', `${p}/knowledge/assets`, { sourceId: src.id, kind: 'logo', rights: { licence: 'Own work' } })).body.id;
  }
  mockAi.queue({
    copies: [{ language: 'en', sentences: [{ text: 'A warm pashmina shawl.', claim: true, factIds: [s.price.id] }, { text: 'Come and see.', claim: false }], hashtags: ['pashmina'], cta: 'Order today' }],
    slides: [{ headline: 'Pashmina' }], scenes: [],
  });
  expect((await wait(s.brand, (await startGenerate(s.brand, s.itemIds, s.facts)).runId)).state).toBe('completed');
  const [draft] = await withBrand(s.brand, (tx) => listDrafts(tx, s.brand, s.facts));
  expect((await wait(s.brand, (await startRender(s.brand, draft!.id, fakeRenderer())).runId)).state).toBe('completed');
  await withBrand(s.brand, (tx) => markReady(tx, s.brand, draft!.id, s.facts));

  const preview = (await call('GET', `${p}/approve/queue/${draft!.id}`)).body;
  expect(preview.draft).toMatchObject({ canApprove: true, risk: 'low' });
  expect((await call('POST', `${p}/approve/queue/${draft!.id}/approve`, { payloadHash: preview.draft.payloadHash })).body.state).toBe('approved');

  const channel = await withBrand(s.brand, (tx) => createChannel(tx, s.brand, { platform: 'instagram', accountName: '@shop', connector: 'mock' }));
  const job = await call('POST', `${p}/publish/jobs`, { draftId: draft!.id, channelId: channel.id, scheduledAt: AT });
  expect(job.status, JSON.stringify(job.body)).toBe(201);
  expect(job.body.payloadHash).toBe(preview.draft.payloadHash);
  return { s, p, draftId: draft!.id, jobId: job.body.id as string, hash: preview.draft.payloadHash as string, logoId };
}

const pkg = async (p: string, jobId: string) => (await call('GET', `${p}/publish/jobs/${jobId}`)).body.package;

/** Sends the job at its time through a mock connector: what it was asked to post, and the job afterwards. */
async function sendAtItsTime(brand: string, jobId: string) {
  const connector = new MockConnector();
  const job = await sendJob(brand, jobId, { connector, now: () => new Date(Date.parse(AT) + 60_000), sleep: async () => {} });
  return { job, calls: connector.calls };
}

describe('the seams between Studio, Approve and Publish', () => {
  it("Studio's real exports carry every field Approve and Publish read", async () => {
    const { s, draftId } = await scheduledPost();
    const fromStudio = await withBrand(s.brand, async (tx) => (await studioReads()).getDraft(tx, s.brand, draftId, s.facts));
    // ReadyDraft (approve/studio.ts) and DraftForPublish (publish/reads.ts), field by field.
    for (const k of ['id', 'planItemId', 'kind', 'status', 'currentVersion', 'readyVersion', 'channel', 'day', 'pillar', 'campaignId', 'content', 'leftOut', 'findings', 'renders', 'factIds', 'assetIds'])
      expect(fromStudio, k).toHaveProperty(k);
    expect(fromStudio).toMatchObject({ status: 'ready', readyVersion: 1, currentVersion: 1, channel: 'instagram', day: '2026-11-29', factIds: [s.price.id] });
    expect(typeof fromStudio!.renders[0]!.sha256).toBe('string');
    expect(fromStudio!.renders[0]).toMatchObject({ ratio: expect.any(String), key: expect.stringMatching(/^tenant\//), width: expect.any(Number), height: expect.any(Number), index: 0, type: 'image' });
    for (const f of fromStudio!.findings) expect(Object.keys(f).sort()).toEqual(['blocking', 'check', 'message', 'where']);
    // GateApproval: what Publish binds a job to.
    const gate = await withBrand(s.brand, async (tx) => (await reads()).validApproval(tx, s.brand, draftId, s.facts));
    expect(gate).toMatchObject({ id: expect.any(String), objectId: draftId, objectVersion: 1, payloadHash: expect.stringMatching(/^[0-9a-f]{64}$/), expiresAt: expect.any(Date) });
  });

  it('hands the owner exactly the approved copy and media, and sends exactly that to a connector', async () => {
    const { s, p, jobId } = await scheduledPost();
    const shown = await pkg(p, jobId);
    expect(shown).toMatchObject({ available: true, ratio: '1:1', captions: [{ language: 'en', caption: 'A warm pashmina shawl. Come and see.', cta: 'Order today', hashtags: ['#pashmina'] }] });
    expect(shown.media).toHaveLength(1);
    expect(shown.media[0].url).toContain(`/brand/${s.brand}/asset/`);
    const { job, calls } = await sendAtItsTime(s.brand, jobId);
    expect(job.state).toBe('published');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.req).toMatchObject({ caption: 'A warm pashmina shawl. Come and see.\n\nOrder today', hashtags: ['#pashmina'], media: [{ ratio: '1:1', kind: 'image' }] });
  });

  // Each change below lands after the job was scheduled. Nothing stale may reach the package or a connector.
  const stopped = async (post: Awaited<ReturnType<typeof scheduledPost>>) => {
    expect(await pkg(post.p, post.jobId)).toMatchObject({ available: false, captions: [], media: [] });
    const { job, calls } = await sendAtItsTime(post.s.brand, post.jobId);
    expect(job.state).toBe('blocked');
    expect(calls).toEqual([]);
  };

  it('stops the post when the cited fact expires', async () => {
    const post = await scheduledPost();
    await t.adminQuery(`update facts set expires_at = now() - interval '1 minute' where id = $1`, [post.s.price.id]);
    await stopped(post);
  });

  it('stops the post when the cited fact is rejected', async () => {
    const post = await scheduledPost();
    expect((await call('POST', `${post.p}/knowledge/facts/${post.s.price.id}/reject`, { reason: 'Wrong price' })).status).toBe(200);
    await stopped(post);
  });

  it('stops the post when the draft gets a new version', async () => {
    const post = await scheduledPost();
    expect((await call('PATCH', `${post.p}/studio/drafts/${post.draftId}`, { slides: [{ headline: 'Changed' }] })).status).toBe(200);
    await stopped(post);
  });

  it('stops the post when the approval is withdrawn', async () => {
    const post = await scheduledPost();
    expect((await call('POST', `${post.p}/approve/queue/${post.draftId}/reject`, { payloadHash: post.hash, reason: 'Not now' })).status).toBe(200);
    await stopped(post);
  });

  it('stops the post while approvals are paused for the brand', async () => {
    const post = await scheduledPost();
    expect((await call('POST', `${post.p}/approve/pause`, { reason: 'Crisis' })).status).toBe(200);
    await stopped(post);
  });

  it('stops the post when the logo drawn into it loses its rights', async () => {
    const post = await scheduledPost({ logo: true });
    expect((await call('PATCH', `${post.p}/knowledge/assets/${post.logoId}`, { rights: {} })).status).toBe(200);
    await stopped(post);
  });

  it("stops the post when its plan item moves to another day, which is part of what was approved", async () => {
    const post = await scheduledPost();
    expect((await call('PATCH', `${post.p}/plan/items/${post.s.itemIds[0]}`, { day: '2026-11-30' })).status).toBe(200);
    await stopped(post);
  });

  it('sends nothing for an archived brand: its jobs are never due', async () => {
    const post = await scheduledPost();
    expect((await call('POST', `${post.p}/archive`)).status).toBe(200);
    expect((await dueJobs(new Date(Date.parse(AT) + 60_000))).map((j) => j.jobId)).not.toContain(post.jobId);
  });
});
