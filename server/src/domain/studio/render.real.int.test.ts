import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { studioBrand } from '../../../test/fixtures/studio/setup.ts';
import { launchTestWorkflows, testDb, type TestDb } from '../../../test/helpers.ts';
import { mockAi } from '../../ai/index.ts';
import { withBrand } from '../../db/tenant.ts';
import { getObject } from '../../storage/index.ts';
import { SIZES } from '../../render/index.ts';
import { getDraft, listDrafts } from './drafts.ts';
import { getRun, startGenerate, startRender } from './runs.ts';

let t: TestDb;
let stop: () => Promise<void>;
beforeAll(async () => { t = await testDb(); stop = await launchTestWorkflows(t); });
afterAll(async () => { await stop(); await t.close(); });
afterEach(() => mockAi.reset());

const wait = async (brand: string, runId: string) => {
  for (let i = 0; i < 400; i++) {
    const run = await withBrand(brand, (tx) => getRun(tx, brand, runId));
    if (run.state !== 'running') return run;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('run did not finish');
};
const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;

it('renders a three-slide carousel with the real engine: PNGs of the right size, each hash matches its bytes', async () => {
  const s = await studioBrand(t, { formats: ['carousel'] });
  mockAi.queue({
    copies: [{ language: 'en', sentences: [{ text: 'A warm pashmina shawl.', claim: true, factIds: [s.price.id] }], hashtags: [], cta: 'Order today' }],
    slides: [{ headline: 'Pashmina' }, { headline: 'Hand-woven' }, { headline: 'Shop now' }],
  });
  expect((await wait(s.brand, (await startGenerate(s.brand, s.itemIds, s.facts)).runId)).state).toBe('completed');
  const [d] = await withBrand(s.brand, (tx) => listDrafts(tx, s.brand, s.facts));
  const run = await wait(s.brand, (await startRender(s.brand, d!.id)).runId); // no renderer given: the real engine
  expect(run).toMatchObject({ state: 'completed', counts: { rendered: 6 } });
  const { renders } = await withBrand(s.brand, (tx) => getDraft(tx, s.brand, d!.id, s.facts));
  expect(renders).toHaveLength(6);
  for (const r of renders) {
    const bytes = await getObject(r.key);
    const meta = await sharp(bytes).metadata();
    expect(meta).toMatchObject({ format: 'png', width: r.width, height: r.height });
    expect({ width: r.width, height: r.height }).toEqual(SIZES[r.ratio]);
    expect(sha256(bytes)).toBe(r.sha256);
  }
  expect(new Set(renders.map((r) => r.ratio)).size).toBe(2);
}, 60_000);

it.skipIf(!hasFfmpeg)('renders a three-scene video with the real engine and ffmpeg: an MP4 stored with its checksum, and the draft is rendered', async () => {
  const s = await studioBrand(t, { formats: ['short_video'] });
  mockAi.queue({
    copies: [{ language: 'en', sentences: [{ text: 'A warm pashmina shawl.', claim: true, factIds: [s.price.id] }], hashtags: [], cta: 'Order today' }],
    scenes: ['Pashmina', 'Hand-woven', 'Shop now'].map((onScreenText) => ({ onScreenText, voiceover: 'Warm and soft.', shot: 'Close-up', seconds: 1 })),
  });
  expect((await wait(s.brand, (await startGenerate(s.brand, s.itemIds, s.facts)).runId)).state).toBe('completed');
  const [d] = await withBrand(s.brand, (tx) => listDrafts(tx, s.brand, s.facts));
  expect(d!.findings).toContainEqual(expect.objectContaining({ check: 'not_rendered' }));
  const run = await wait(s.brand, (await startRender(s.brand, d!.id)).runId); // no renderer given: the real engine
  expect(run).toMatchObject({ state: 'completed', counts: { rendered: 4 }, error: null }); // three 9:16 cards and the MP4
  const v = await withBrand(s.brand, (tx) => getDraft(tx, s.brand, d!.id, s.facts));
  const [video] = v.renders.filter((r) => r.type === 'video');
  const bytes = await getObject(video!.key);
  expect(Buffer.from(bytes.subarray(4, 8)).toString('ascii')).toBe('ftyp'); // an MP4 container
  expect(video).toMatchObject({ ratio: '9:16', ...SIZES['9:16'], sha256: sha256(bytes) });
  expect(v.findings.filter((f) => f.check === 'not_rendered')).toEqual([]);
}, 60_000);
