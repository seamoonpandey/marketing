// The render step: the current version's cards at the draft's ratios, and the video for a video draft.
import { createHash, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { studioVersions, type RenderRecord } from '../../db/schema/studio.ts';
import { tenantOf, withBrand } from '../../db/tenant.ts';
import { putObject, objectKey } from '../../storage/index.ts';
import { audit } from '../audit/index.ts';
import { cardsOf } from './checks.ts';
import { getDraftRow, invalidateReady } from './drafts.ts';
import { assetBytes, loadEnv, loadLogo } from './env.ts';
import { defaultRenderer, isRenderUnavailable, SIZES, type Renderer, type Slide } from './render-types.ts';

/** Renderers handed to startRender, by run id; the workflow step takes its own. In-process only. */
export const pendingRenderers = new Map<string, Renderer>();

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
export const VIDEO_UNAVAILABLE = 'The video could not be made because the video engine (ffmpeg) is not available on this server; the images were kept.';

export async function renderDraft(brandId: string, runId: string, draftId: string): Promise<{ rendered: number; note?: string }> {
  const plan = await withBrand(brandId, async (tx) => {
    const d = await getDraftRow(tx, brandId, draftId);
    const [v] = await tx.select().from(studioVersions).where(and(eq(studioVersions.draftId, d.id), eq(studioVersions.version, d.currentVersion)));
    const env = await loadEnv(tx, brandId);
    const cards = cardsOf(d.kind, v!.content);
    const logo = cards.length ? await loadLogo(tx, brandId, env) : undefined;
    const slides: Slide[] = [];
    for (const [n, c] of cards.entries()) {
      const photoAssetId = d.kind === 'video' ? undefined : v!.content.slides[n]?.photoAssetId;
      const photo = photoAssetId ? await assetBytes(tx, brandId, env, photoAssetId) : undefined; // an asset without rights is left off, and the draft is blocked by no_rights
      slides.push({ template: v!.content.template, headline: c.headline, ...(c.subline ? { subline: c.subline } : {}), ...(c.badge ? { badge: c.badge } : {}), ...(photo ? { photo } : {}) });
    }
    return {
      d, version: v!.version, kind: d.kind, ratios: v!.content.ratios, seconds: v!.content.scenes.map((s) => s.seconds), slides,
      kit: { ...env.kit, ...(logo ? { logo: logo.bytes } : {}) }, used: logo ? { logoAssetId: logo.assetId } : {}, tenantId: await tenantOf(tx),
    };
  });
  if (!plan.slides.length) return { rendered: 0 };

  const renderer = pendingRenderers.get(runId) ?? (await defaultRenderer());
  pendingRenderers.delete(runId);
  const records: RenderRecord[] = [];
  const first: Uint8Array[] = [];
  const store = async (body: Uint8Array, ext: string, type: string) => {
    const key = objectKey(plan.tenantId, brandId, 'asset', randomUUID(), ext);
    await putObject(key, body, type);
    return { key, sha256: sha256(body), ...plan.used };
  };
  for (const ratio of plan.ratios)
    for (const [index, slide] of plan.slides.entries()) {
      const r = await renderer.renderSlide(slide, plan.kit, ratio);
      records.push({ ratio, width: r.width, height: r.height, overflow: r.overflow, index, type: 'image', ...(await store(r.png, 'png', 'image/png')) });
      if (ratio === plan.ratios[0]) first.push(r.png);
    }
  let note: string | undefined;
  if (plan.kind === 'video') {
    try {
      const v = await renderer.renderVideo({ frames: first, secondsEach: plan.seconds });
      const ratio = plan.ratios[0]!;
      records.push({ ratio, ...SIZES[ratio], overflow: false, index: 0, type: 'video', ...(await store(v.mp4, 'mp4', 'video/mp4')) });
    } catch (e) {
      if (!isRenderUnavailable(e)) throw e;
      note = VIDEO_UNAVAILABLE;
    }
  }
  await withBrand(brandId, async (tx) => {
    const d = await getDraftRow(tx, brandId, draftId, true);
    await tx.update(studioVersions).set({ renders: records }).where(and(eq(studioVersions.draftId, d.id), eq(studioVersions.version, plan.version)));
    // New files replace the ones a ready version was approved with.
    if (d.readyVersion === plan.version) await invalidateReady(tx, brandId, d, 'draft re-rendered');
    await audit(tx, { brandId, actor: 'system', action: 'studio.draft.render', objectType: 'studio_draft', objectId: d.id, objectVersion: plan.version, result: 'ok', reason: `${records.length} files` });
  });
  return { rendered: records.length, ...(note ? { note } : {}) };
}
