import { createRoute, z } from '@hono/zod-openapi';
import * as C from '../../contracts/studio.ts';
import { ratios, templates } from '../../db/schema/studio.ts';
import { withBrand } from '../../db/tenant.ts';
import { BrandItemParams, BrandParams } from '../../http/brand.ts';
import { errorResponse as E, createRouter, json } from '../../http/router.ts';
import { presignDownload } from '../../storage/index.ts';
import { remainingMonthlyCap } from '../costs/index.ts';
import { approvedFacts } from '../knowledge/index.ts';
import { editDraft, getDraft, markReady, type DraftView, type StudioRunRow } from './drafts.ts';
import { estimateDrafts } from './generate.ts';
import { overview } from './overview.ts';
import { latestRun, cancelRun, getRun, retryRun, startGenerate, startRender } from './runs.ts';
import { SIZES } from './render-types.ts';

const tags = ['studio'];
const P = '/brands/{brandId}/studio';
const body = <T extends z.ZodType>(schema: T) => ({ body: { required: true, content: { 'application/json': { schema } } } });
const iso = (d: Date | null) => (d ? d.toISOString() : null);

const toRun = (r: StudioRunRow): z.infer<typeof C.StudioRun> => ({
  id: r.id, kind: r.kind, targets: r.targets, state: r.state, error: r.error, startedAt: iso(r.startedAt), finishedAt: iso(r.finishedAt),
  estimate: r.estimate, actual: r.actual, counts: r.counts, createdAt: r.createdAt.toISOString(),
});
const toFact = (f: DraftView['facts'][number]): z.infer<typeof C.FactRef> => ({ id: f.id, section: f.section, subjectName: f.subjectName, field: f.field, value: f.value, unit: f.unit });
/** Presigned URLs are issued here, from keys read inside the brand's scope. The key and the hash stay server side. */
const toView = async (v: DraftView, brandId: string, run: StudioRunRow | null): Promise<z.infer<typeof C.DraftView>> => ({
  draft: { id: v.id, planItemId: v.planItemId, kind: v.kind, status: v.status, currentVersion: v.currentVersion, readyVersion: v.readyVersion, readyAt: iso(v.readyAt), createdAt: v.createdAt.toISOString() },
  version: { ...v.version, createdAt: v.version.createdAt.toISOString() },
  versions: v.versions.map((x) => ({ ...x, createdAt: x.createdAt.toISOString() })),
  planItem: v.planItem && { ...v.planItem, channel: v.planItem.channel as never, format: v.planItem.format as never },
  planApproved: v.planApproved, weekStart: v.weekStart, channel: v.channel, languages: v.languages, missingLanguages: v.missingLanguages,
  content: { copies: v.content.copies, slides: v.content.slides, scenes: v.content.scenes, template: v.content.template, ratios: v.content.ratios },
  leftOut: v.leftOut, facts: v.facts.map(toFact), findings: v.findings, blockingCount: v.blockingCount,
  renders: await Promise.all(v.renders.map(async (r) => ({ ratio: r.ratio, width: r.width, height: r.height, overflow: r.overflow, index: r.index, type: r.type, url: await presignDownload(r.key) }))),
  canMarkReady: v.canMarkReady, cannotMarkReadyReason: v.cannotMarkReadyReason, latestRun: run && toRun(run),
});

const facts = (brandId: string) => withBrand(brandId, (tx) => approvedFacts(tx, brandId));
const runOf = (brandId: string, id: string) => withBrand(brandId, async (tx) => toRun(await getRun(tx, brandId, id)));
/** The draft as the editor shows it, with its newest run. */
const viewOf = async (brandId: string, f: (tx: Parameters<Parameters<typeof withBrand>[1]>[0], facts: Awaited<ReturnType<typeof approvedFacts>>) => Promise<string>) => {
  const { v, run } = await withBrand(brandId, async (tx) => {
    const fs = await approvedFacts(tx, brandId);
    const id = await f(tx, fs);
    const v = await getDraft(tx, brandId, id, fs);
    return { v, run: await latestRun(tx, brandId, undefined, [id, v.planItemId]) };
  });
  return toView(v, brandId, run);
};

const LABELS = { headline: ['Headline', 'A large headline with an optional subline and badge.'], offer: ['Offer', 'A badge-led layout for prices and offers.'], quote: ['Quote', 'A quotation or proof point.'] } as const;
const RATIO_LABELS = { '1:1': 'Square', '4:5': 'Portrait', '9:16': 'Story and short video', '16:9': 'Landscape video' } as const;

export const routes = createRouter()
  .openapi(
    createRoute({ method: 'get', path: `${P}/overview`, tags, request: { params: BrandParams, query: C.OverviewQuery }, responses: { 200: json(C.Overview), 400: E, 404: E } }),
    async (c) => {
      const { brandId } = c.req.valid('param');
      const o = await withBrand(brandId, async (tx) => overview(tx, brandId, c.req.valid('query').weekStart, await approvedFacts(tx, brandId)));
      return c.json({ ...o, latestRun: o.latestRun && toRun(o.latestRun) } as z.infer<typeof C.Overview>, 200);
    },
  )
  .openapi(
    createRoute({ method: 'get', path: `${P}/templates`, tags, request: { params: BrandParams }, responses: { 200: json(C.TemplateList), 404: E } }),
    async (c) => {
      const { brandId } = c.req.valid('param');
      await withBrand(brandId, async () => undefined); // 404 and a denied event for a brand outside the tenant
      return c.json({
        templates: templates.map((name) => ({ name, label: LABELS[name][0], description: LABELS[name][1] })),
        ratios: ratios.map((ratio) => ({ ratio, ...SIZES[ratio], label: RATIO_LABELS[ratio] })),
      }, 200);
    },
  )
  .openapi(
    createRoute({ method: 'post', path: `${P}/drafts/estimate`, tags, request: { params: BrandParams, ...body(C.DraftCreate) }, responses: { 200: json(C.Estimate), 400: E, 404: E, 409: E } }),
    async (c) => {
      const { brandId } = c.req.valid('param');
      const { planItemIds } = c.req.valid('json');
      const estimate = await estimateDrafts(brandId, planItemIds, await facts(brandId));
      return c.json({ estimate, remaining: await withBrand(brandId, (tx) => remainingMonthlyCap(tx)), count: new Set(planItemIds).size }, 200);
    },
  )
  .openapi(
    createRoute({ method: 'post', path: `${P}/drafts`, tags, request: { params: BrandParams, ...body(C.DraftCreate) }, responses: { 201: json(C.StudioRun, 'Started'), 400: E, 402: E, 404: E, 409: E } }),
    async (c) => {
      const { brandId } = c.req.valid('param');
      const { runId } = await startGenerate(brandId, c.req.valid('json').planItemIds, await facts(brandId));
      return c.json(await runOf(brandId, runId), 201);
    },
  )
  .openapi(
    createRoute({ method: 'get', path: `${P}/drafts/{id}`, tags, request: { params: BrandItemParams }, responses: { 200: json(C.DraftView), 404: E } }),
    async (c) => {
      const { brandId, id } = c.req.valid('param');
      return c.json(await viewOf(brandId, async () => id), 200);
    },
  )
  .openapi(
    createRoute({ method: 'patch', path: `${P}/drafts/{id}`, tags, request: { params: BrandItemParams, ...body(C.ContentPatch) }, responses: { 200: json(C.DraftView, 'The edit is the new current version'), 400: E, 404: E, 409: E } }),
    async (c) => {
      const { brandId, id } = c.req.valid('param');
      return c.json(await viewOf(brandId, async (tx, f) => (await editDraft(tx, brandId, id, c.req.valid('json'), f)).id), 200);
    },
  )
  .openapi(
    createRoute({ method: 'post', path: `${P}/drafts/{id}/render`, tags, request: { params: BrandItemParams }, responses: { 201: json(C.StudioRun, 'Started. Costs NPR 0.'), 404: E, 409: E } }),
    async (c) => {
      const { brandId, id } = c.req.valid('param');
      const { runId } = await startRender(brandId, id);
      return c.json(await runOf(brandId, runId), 201);
    },
  )
  .openapi(
    createRoute({ method: 'post', path: `${P}/drafts/{id}/ready`, tags, request: { params: BrandItemParams }, responses: { 200: json(C.DraftView), 404: E, 409: E } }),
    async (c) => {
      const { brandId, id } = c.req.valid('param');
      return c.json(await viewOf(brandId, async (tx, f) => (await markReady(tx, brandId, id, f)).id), 200);
    },
  )
  .openapi(
    createRoute({ method: 'get', path: `${P}/runs/{id}`, tags, request: { params: BrandItemParams }, responses: { 200: json(C.StudioRun), 404: E } }),
    async (c) => {
      const { brandId, id } = c.req.valid('param');
      return c.json(await runOf(brandId, id), 200);
    },
  )
  .openapi(
    createRoute({ method: 'post', path: `${P}/runs/{id}/cancel`, tags, request: { params: BrandItemParams }, responses: { 200: json(C.StudioRun), 404: E, 409: E } }),
    async (c) => {
      const { brandId, id } = c.req.valid('param');
      await cancelRun(brandId, id);
      return c.json(await runOf(brandId, id), 200);
    },
  )
  .openapi(
    createRoute({ method: 'post', path: `${P}/runs/{id}/retry`, tags, request: { params: BrandItemParams }, responses: { 200: json(C.StudioRun), 404: E, 409: E } }),
    async (c) => {
      const { brandId, id } = c.req.valid('param');
      await retryRun(brandId, id, await facts(brandId));
      return c.json(await runOf(brandId, id), 200);
    },
  );
