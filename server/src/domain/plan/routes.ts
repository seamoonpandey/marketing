import { createRoute, z } from '@hono/zod-openapi';
import * as C from '../../contracts/plan.ts';
import { withBrand } from '../../db/tenant.ts';
import { BrandItemParams, BrandParams } from '../../http/brand.ts';
import { errorResponse as E, createRouter, json } from '../../http/router.ts';
import { remainingMonthlyCap } from '../costs/index.ts';
import { approvedFacts } from '../knowledge/index.ts';
import { approveBrief, editBrief, estimateBrief } from './brief.ts';
import { createCampaign, getCampaign, listCampaigns, updateCampaign, type Campaign } from './campaigns.ts';
import { cancelRun, estimateWeek, generateBrief, getRun, retryRun, startWeekDraft, type PlanRun } from './draft.ts';
import { briefView, overview, weekView } from './overview.ts';
import { getSettings, setSettings } from './settings.ts';
import { addItem, approveWeek, editItem, getItem, getPlan, removeItem, type WeekPlan } from './weeks.ts';
import type { PlanItem } from './balance.ts';
import type { Brief } from './brief.ts';

const tags = ['plan'];
const P = '/brands/{brandId}/plan';
const body = <T extends z.ZodType>(schema: T) => ({ body: { required: true, content: { 'application/json': { schema } } } });
const WeekParams = BrandParams.extend(C.WeekParams.shape);

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const toRun = (r: PlanRun): z.infer<typeof C.PlanRun> => ({
  id: r.id, kind: r.kind, targetId: r.targetId, state: r.state, error: r.error, startedAt: iso(r.startedAt), finishedAt: iso(r.finishedAt),
  estimate: r.estimate, actual: r.actual, counts: r.counts, createdAt: r.createdAt.toISOString(),
});
const toCampaign = (c: Campaign): z.infer<typeof C.Campaign> => ({
  id: c.id, name: c.name, objective: c.objective, status: c.status, startsOn: c.startsOn, endsOn: c.endsOn, segmentId: c.segmentId,
  opportunityId: c.opportunityId, budgetNpr: c.budgetNpr, createdAt: c.createdAt.toISOString(),
});
const toBrief = (b: Brief | null): z.infer<typeof C.Brief> | null =>
  b && { id: b.id, campaignId: b.campaignId, version: b.version, status: b.status, body: b.body as z.infer<typeof C.BriefBody>, leftOut: b.leftOut as z.infer<typeof C.Brief>['leftOut'], approvedAt: iso(b.approvedAt), createdAt: b.createdAt.toISOString() };
const toPlan = (p: WeekPlan): z.infer<typeof C.WeekPlan> => ({ id: p.id, weekStart: p.weekStart, version: p.version, status: p.status, approvedAt: iso(p.approvedAt), runId: p.runId, createdAt: p.createdAt.toISOString() });
const toItem = (i: PlanItem): z.infer<typeof C.PlanItem> => ({
  id: i.id, weekPlanId: i.weekPlanId, day: i.day, channel: i.channel, format: i.format, pillar: i.pillar, funnel: i.funnel, intent: i.intent,
  segmentId: i.segmentId, campaignId: i.campaignId, idea: i.idea, cta: i.cta, factIds: i.factIds, position: i.position, origin: i.origin,
});
const toFact = (f: Awaited<ReturnType<typeof approvedFacts>>[number]): z.infer<typeof C.FactRef> => ({
  id: f.id, section: f.section, subjectName: f.subjectName, field: f.field, value: f.value, unit: f.unit,
});
const toWeekView = (v: Awaited<ReturnType<typeof weekView>>): z.infer<typeof C.WeekView> => ({
  weekStart: v.weekStart, plan: v.plan && toPlan(v.plan), approvedPlan: v.approvedPlan && toPlan(v.approvedPlan), items: v.items.map(toItem),
  violations: v.violations, blockingCount: v.blockingCount, canApprove: v.canApprove, cannotApproveReason: v.cannotApproveReason,
  facts: v.facts.map(toFact), latestRun: v.latestRun && toRun(v.latestRun), ready: v.ready,
});
const toBriefView = (v: Awaited<ReturnType<typeof briefView>>): z.infer<typeof C.BriefView> => ({
  campaign: toCampaign(v.campaign), approved: toBrief(v.approved), draft: toBrief(v.draft), facts: v.facts.map(toFact),
  latestRun: v.latestRun && toRun(v.latestRun), ready: v.ready,
});

const facts = (brandId: string) => withBrand(brandId, (tx) => approvedFacts(tx, brandId));
const estimated = async (brandId: string, estimate: z.infer<typeof C.Estimate>['estimate']): Promise<z.infer<typeof C.Estimate>> => ({
  estimate, remaining: await withBrand(brandId, (tx) => remainingMonthlyCap(tx)),
});
const runOf = (brandId: string, id: string) => withBrand(brandId, async (tx) => toRun(await getRun(tx, brandId, id)));

export const routes = createRouter()
  .openapi(
    createRoute({ method: 'get', path: `${P}/overview`, tags, request: { params: BrandParams }, responses: { 200: json(C.Overview), 404: E } }),
    async (c) => {
      const { brandId } = c.req.valid('param');
      const o = await withBrand(brandId, async (tx) => overview(tx, brandId, await approvedFacts(tx, brandId)));
      return c.json({
        ready: o.ready, activeCampaigns: o.activeCampaigns.map(toCampaign), monthCost: o.monthCost,
        weeks: o.weeks.map((w) => ({ ...w, latestRun: w.latestRun && toRun(w.latestRun) })),
        opportunities: o.opportunities.map((x) => ({ id: x.id, title: x.title, suggestedAction: x.suggestedAction, whyItMatters: x.whyItMatters, confidence: x.confidence })),
      }, 200);
    },
  )
  .openapi(
    createRoute({ method: 'get', path: `${P}/settings`, tags, request: { params: BrandParams }, responses: { 200: json(C.Settings), 404: E } }),
    async (c) => {
      const { brandId } = c.req.valid('param');
      return c.json(await withBrand(brandId, (tx) => getSettings(tx, brandId)), 200);
    },
  )
  .openapi(
    createRoute({ method: 'put', path: `${P}/settings`, tags, request: { params: BrandParams, ...body(C.Settings) }, responses: { 200: json(C.Settings), 400: E, 404: E } }),
    async (c) => {
      const { brandId } = c.req.valid('param');
      return c.json(await withBrand(brandId, (tx) => setSettings(tx, brandId, c.req.valid('json'))), 200);
    },
  )
  .openapi(
    createRoute({ method: 'get', path: `${P}/campaigns`, tags, request: { params: BrandParams, query: C.CampaignsQuery }, responses: { 200: json(z.array(C.Campaign), 'Newest first'), 404: E } }),
    async (c) => {
      const { brandId } = c.req.valid('param');
      return c.json((await withBrand(brandId, (tx) => listCampaigns(tx, brandId, c.req.valid('query').status))).map(toCampaign), 200);
    },
  )
  .openapi(
    createRoute({ method: 'post', path: `${P}/campaigns`, tags, request: { params: BrandParams, ...body(C.CampaignCreate) }, responses: { 201: json(C.Campaign, 'Created'), 400: E, 404: E } }),
    async (c) => {
      const { brandId } = c.req.valid('param');
      return c.json(toCampaign(await withBrand(brandId, (tx) => createCampaign(tx, brandId, c.req.valid('json')))), 201);
    },
  )
  .openapi(
    createRoute({ method: 'get', path: `${P}/campaigns/{id}`, tags, request: { params: BrandItemParams }, responses: { 200: json(C.Campaign), 404: E } }),
    async (c) => {
      const { brandId, id } = c.req.valid('param');
      return c.json(toCampaign(await withBrand(brandId, (tx) => getCampaign(tx, brandId, id))), 200);
    },
  )
  .openapi(
    createRoute({ method: 'patch', path: `${P}/campaigns/{id}`, tags, request: { params: BrandItemParams, ...body(C.CampaignPatch) }, responses: { 200: json(C.Campaign), 400: E, 404: E } }),
    async (c) => {
      const { brandId, id } = c.req.valid('param');
      return c.json(toCampaign(await withBrand(brandId, (tx) => updateCampaign(tx, brandId, id, c.req.valid('json')))), 200);
    },
  )
  .openapi(
    createRoute({ method: 'get', path: `${P}/campaigns/{id}/brief`, tags, request: { params: BrandItemParams }, responses: { 200: json(C.BriefView), 404: E } }),
    async (c) => {
      const { brandId, id } = c.req.valid('param');
      return c.json(toBriefView(await withBrand(brandId, async (tx) => briefView(tx, brandId, id, await approvedFacts(tx, brandId)))), 200);
    },
  )
  .openapi(
    createRoute({ method: 'patch', path: `${P}/campaigns/{id}/brief`, tags, request: { params: BrandItemParams, ...body(C.BriefEdit) }, responses: { 200: json(C.BriefView, 'The edit is now the draft'), 400: E, 404: E } }),
    async (c) => {
      const { brandId, id } = c.req.valid('param');
      const view = await withBrand(brandId, async (tx) => {
        const f = await approvedFacts(tx, brandId);
        await editBrief(tx, brandId, id, c.req.valid('json').body, f);
        return briefView(tx, brandId, id, f);
      });
      return c.json(toBriefView(view), 200);
    },
  )
  .openapi(
    createRoute({ method: 'post', path: `${P}/campaigns/{id}/brief/estimate`, tags, request: { params: BrandItemParams }, responses: { 200: json(C.Estimate), 400: E, 404: E } }),
    async (c) => {
      const { brandId, id } = c.req.valid('param');
      return c.json(await estimated(brandId, await estimateBrief(brandId, id, await facts(brandId))), 200);
    },
  )
  .openapi(
    createRoute({ method: 'post', path: `${P}/campaigns/{id}/brief/generate`, tags, request: { params: BrandItemParams }, responses: { 201: json(C.PlanRun, 'Started'), 400: E, 402: E, 404: E, 409: E } }),
    async (c) => {
      const { brandId, id } = c.req.valid('param');
      const { runId } = await generateBrief(brandId, id, await facts(brandId));
      return c.json(await runOf(brandId, runId), 201);
    },
  )
  .openapi(
    createRoute({ method: 'post', path: `${P}/campaigns/{id}/brief/approve`, tags, request: { params: BrandItemParams, ...body(C.ApproveBody) }, responses: { 200: json(C.BriefView), 400: E, 404: E, 409: E } }),
    async (c) => {
      const { brandId, id } = c.req.valid('param');
      const { version } = c.req.valid('json');
      const view = await withBrand(brandId, async (tx) => {
        const f = await approvedFacts(tx, brandId);
        await approveBrief(tx, brandId, id, f, version);
        return briefView(tx, brandId, id, f);
      });
      return c.json(toBriefView(view), 200);
    },
  )
  .openapi(
    createRoute({ method: 'get', path: `${P}/weeks/{weekStart}`, tags, request: { params: WeekParams }, responses: { 200: json(C.WeekView), 400: E, 404: E } }),
    async (c) => {
      const { brandId, weekStart } = c.req.valid('param');
      return c.json(toWeekView(await withBrand(brandId, async (tx) => weekView(tx, brandId, weekStart, await approvedFacts(tx, brandId)))), 200);
    },
  )
  .openapi(
    createRoute({ method: 'post', path: `${P}/weeks/{weekStart}/estimate`, tags, request: { params: WeekParams }, responses: { 200: json(C.Estimate), 400: E, 404: E } }),
    async (c) => {
      const { brandId, weekStart } = c.req.valid('param');
      return c.json(await estimated(brandId, await estimateWeek(brandId, weekStart, await facts(brandId))), 200);
    },
  )
  .openapi(
    createRoute({ method: 'post', path: `${P}/weeks/{weekStart}/draft`, tags, request: { params: WeekParams }, responses: { 201: json(C.PlanRun, 'Started'), 400: E, 402: E, 404: E, 409: E } }),
    async (c) => {
      const { brandId, weekStart } = c.req.valid('param');
      const { runId } = await startWeekDraft(brandId, weekStart, await facts(brandId));
      return c.json(await runOf(brandId, runId), 201);
    },
  )
  .openapi(
    createRoute({ method: 'post', path: `${P}/weeks/{weekStart}/approve`, tags, request: { params: WeekParams, ...body(C.ApproveBody) }, responses: { 200: json(C.WeekView), 400: E, 404: E, 409: E } }),
    async (c) => {
      const { brandId, weekStart } = c.req.valid('param');
      const { version } = c.req.valid('json');
      const view = await withBrand(brandId, async (tx) => {
        const f = await approvedFacts(tx, brandId);
        await approveWeek(tx, brandId, weekStart, f, version);
        return weekView(tx, brandId, weekStart, f);
      });
      return c.json(toWeekView(view), 200);
    },
  )
  .openapi(
    createRoute({ method: 'post', path: `${P}/weeks/{weekStart}/items`, tags, request: { params: WeekParams, ...body(C.ItemCreate) }, responses: { 201: json(C.ItemResult, 'Created'), 400: E, 404: E } }),
    async (c) => {
      const { brandId, weekStart } = c.req.valid('param');
      const { item, plan } = await withBrand(brandId, async (tx) => {
        const item = await addItem(tx, brandId, weekStart, c.req.valid('json'));
        return { item, plan: await getPlan(tx, brandId, item.weekPlanId) };
      });
      return c.json({ item: toItem(item), plan: toPlan(plan) }, 201);
    },
  )
  .openapi(
    createRoute({ method: 'patch', path: `${P}/items/{id}`, tags, request: { params: BrandItemParams, ...body(C.ItemPatch) }, responses: { 200: json(C.ItemResult), 400: E, 404: E } }),
    async (c) => {
      const { brandId, id } = c.req.valid('param');
      const { item, plan } = await withBrand(brandId, async (tx) => {
        const item = await editItem(tx, brandId, id, c.req.valid('json'));
        return { item, plan: await getPlan(tx, brandId, item.weekPlanId) };
      });
      return c.json({ item: toItem(item), plan: toPlan(plan) }, 200);
    },
  )
  .openapi(
    createRoute({ method: 'delete', path: `${P}/items/{id}`, tags, request: { params: BrandItemParams }, responses: { 200: json(C.ItemRemoved), 404: E } }),
    async (c) => {
      const { brandId, id } = c.req.valid('param');
      const plan = await withBrand(brandId, async (tx) => {
        const { weekPlanId } = await getItem(tx, brandId, id);
        await removeItem(tx, brandId, id);
        return getPlan(tx, brandId, weekPlanId);
      });
      return c.json({ plan: toPlan(plan) }, 200);
    },
  )
  .openapi(
    createRoute({ method: 'get', path: `${P}/runs/{id}`, tags, request: { params: BrandItemParams }, responses: { 200: json(C.PlanRun), 404: E } }),
    async (c) => {
      const { brandId, id } = c.req.valid('param');
      return c.json(await runOf(brandId, id), 200);
    },
  )
  .openapi(
    createRoute({ method: 'post', path: `${P}/runs/{id}/cancel`, tags, request: { params: BrandItemParams }, responses: { 200: json(C.PlanRun), 404: E, 409: E } }),
    async (c) => {
      const { brandId, id } = c.req.valid('param');
      await cancelRun(brandId, id);
      return c.json(await runOf(brandId, id), 200);
    },
  )
  .openapi(
    createRoute({ method: 'post', path: `${P}/runs/{id}/retry`, tags, request: { params: BrandItemParams }, responses: { 200: json(C.PlanRun), 404: E, 409: E } }),
    async (c) => {
      const { brandId, id } = c.req.valid('param');
      await retryRun(brandId, id);
      return c.json(await runOf(brandId, id), 200);
    },
  );
