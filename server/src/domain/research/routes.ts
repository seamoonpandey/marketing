import { createRoute, z } from '@hono/zod-openapi';
import * as C from '../../contracts/research.ts';
import { withBrand } from '../../db/tenant.ts';
import { BrandItemParams, BrandParams } from '../../http/brand.ts';
import { NotFoundError } from '../../http/errors.ts';
import { createRouter, errorResponse, json } from '../../http/router.ts';
import { listCompetitors } from '../brands/index.ts';
import { approvedFacts } from '../knowledge/index.ts';
import { approveBattlecard, generateBattlecard, getBattlecards, type Battlecard } from './battlecard.ts';
import { getProfile, listObservations, type ObservationRow } from './observations.ts';
import { decideOpportunity, listOpportunities, restoreOpportunity, scanOpportunities, type Opportunity } from './opportunities.ts';
import { cancelRun, confirmRun, getRun, getSchedule, listRuns, retryRun, setSchedule, startRun, type Schedule, type WatchRun } from './watch/index.ts';
import { addTarget, listTargets, removeTarget, setTargetStatus, suggestTargets, type WatchTarget } from './targets.ts';

const tags = ['research'];
const P = '/brands/{brandId}/research';
const CompetitorParams = BrandParams.extend({
  competitorId: z.string().openapi({ param: { name: 'competitorId', in: 'path' } }),
});
const body = <T extends z.ZodType>(schema: T) => ({ body: { required: true, content: { 'application/json': { schema } } } });
const E = errorResponse;

const toTarget = (t: WatchTarget): z.infer<typeof C.WatchTarget> => ({
  id: t.id, competitorId: t.competitorId, url: t.url, label: t.label, status: t.status, failCount: t.failCount,
  lastError: t.lastError, lastSourceId: t.lastSourceId, createdAt: t.createdAt.toISOString(),
});

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const toRun = (r: WatchRun): z.infer<typeof C.WatchRun> => ({
  id: r.id, trigger: r.trigger, state: r.state, error: r.error, startedAt: iso(r.startedAt), finishedAt: iso(r.finishedAt),
  estimate: r.estimate, actual: r.actual, counts: r.counts, createdAt: r.createdAt.toISOString(),
});
const toSchedule = (s: Schedule) => ({ ...s, lastRunAt: iso(s.lastRunAt) });
const toObservation = (o: ObservationRow): z.infer<typeof C.Observation> => ({
  id: o.id, competitorId: o.competitorId, competitorName: o.competitorName, runId: o.runId, type: o.type, summary: o.summary,
  before: o.before, after: o.after, url: o.url, observedAt: o.observedAt.toISOString(), confidence: o.confidence,
});
const toOpportunity = (o: Opportunity): z.infer<typeof C.Opportunity> => ({
  id: o.id, runId: o.runId, kind: o.kind, title: o.title, hypothesis: o.hypothesis, suggestedAction: o.suggestedAction, whyItMatters: o.whyItMatters,
  observationIds: o.observationIds, evidence: o.evidence, confidence: o.confidence, impact: o.impact, effort: o.effort, status: o.status,
  decidedAt: iso(o.decidedAt), createdAt: o.createdAt.toISOString(),
});
const toBattlecard = (b: Battlecard): z.infer<typeof C.Battlecard> => ({
  id: b.id, competitorId: b.competitorId, version: b.version, status: b.status, body: b.body as z.infer<typeof C.BattlecardBody>,
  leftOut: b.leftOut as { text: string; reason: string }[], approvedAt: iso(b.approvedAt), createdAt: b.createdAt.toISOString(),
});

export const routes = createRouter()
  .openapi(
    createRoute({
      method: 'get', path: `${P}/targets`, tags, request: { params: BrandParams, query: C.TargetsQuery },
      responses: { 200: json(z.array(C.WatchTarget)), 404: E },
    }),
    async (c) => {
      const { brandId } = c.req.valid('param');
      const { competitorId } = c.req.valid('query');
      return c.json((await withBrand(brandId, (tx) => listTargets(tx, brandId, competitorId))).map(toTarget), 200);
    },
  )
  .openapi(
    createRoute({
      method: 'post', path: `${P}/targets`, tags, request: { params: BrandParams, ...body(C.TargetCreate) },
      responses: { 201: json(C.WatchTarget, 'Created'), 400: E, 404: E, 409: E },
    }),
    async (c) => {
      const { brandId } = c.req.valid('param');
      return c.json(toTarget(await withBrand(brandId, (tx) => addTarget(tx, brandId, c.req.valid('json')))), 201);
    },
  )
  .openapi(
    createRoute({
      method: 'post', path: `${P}/targets/suggest`, tags, request: { params: BrandParams, ...body(C.SuggestRequest) },
      responses: { 200: json(C.SuggestResponse), 400: E, 404: E },
    }),
    async (c) => {
      const { brandId } = c.req.valid('param');
      const { competitorId } = c.req.valid('json');
      const site = await withBrand(brandId, async (tx) => {
        const rival = (await listCompetitors(tx, brandId)).find((r) => r.id === competitorId);
        if (!rival) throw new NotFoundError('competitor', competitorId);
        return rival.site;
      });
      return c.json({ urls: site ? await suggestTargets(site) : [] }, 200);
    },
  )
  .openapi(
    createRoute({
      method: 'patch', path: `${P}/targets/{id}`, tags, request: { params: BrandItemParams, ...body(C.TargetPatch) },
      responses: { 200: json(C.WatchTarget), 400: E, 404: E },
    }),
    async (c) => {
      const { brandId, id } = c.req.valid('param');
      return c.json(toTarget(await withBrand(brandId, (tx) => setTargetStatus(tx, brandId, id, c.req.valid('json').status))), 200);
    },
  )
  .openapi(
    createRoute({
      method: 'delete', path: `${P}/targets/{id}`, tags, request: { params: BrandItemParams },
      responses: { 204: { description: 'Deleted' }, 404: E },
    }),
    async (c) => {
      const { brandId, id } = c.req.valid('param');
      await withBrand(brandId, (tx) => removeTarget(tx, brandId, id));
      return c.body(null, 204);
    },
  )
  .openapi(
    createRoute({
      method: 'get', path: `${P}/runs`, tags, request: { params: BrandParams },
      responses: { 200: json(z.array(C.WatchRun), 'Newest first'), 404: E },
    }),
    async (c) => {
      const { brandId } = c.req.valid('param');
      return c.json((await withBrand(brandId, (tx) => listRuns(tx, brandId))).map(toRun), 200);
    },
  )
  .openapi(
    createRoute({
      method: 'post', path: `${P}/runs`, tags, request: { params: BrandParams, ...body(C.RunCreate) },
      responses: { 201: json(C.WatchRun, 'Started'), 404: E, 409: E },
    }),
    async (c) => {
      const { brandId } = c.req.valid('param');
      const { runId } = await startRun(brandId, c.req.valid('json').trigger);
      return c.json(toRun(await withBrand(brandId, (tx) => getRun(tx, brandId, runId))), 201);
    },
  )
  .openapi(
    createRoute({
      method: 'get', path: `${P}/runs/{id}`, tags, request: { params: BrandItemParams },
      responses: { 200: json(C.WatchRun), 404: E },
    }),
    async (c) => {
      const { brandId, id } = c.req.valid('param');
      return c.json(toRun(await withBrand(brandId, (tx) => getRun(tx, brandId, id))), 200);
    },
  )
  .openapi(
    createRoute({
      method: 'post', path: `${P}/runs/{id}/confirm`, tags, request: { params: BrandItemParams },
      responses: { 200: json(C.WatchRun), 404: E, 409: E },
    }),
    async (c) => {
      const { brandId, id } = c.req.valid('param');
      await confirmRun(brandId, id);
      return c.json(toRun(await withBrand(brandId, (tx) => getRun(tx, brandId, id))), 200);
    },
  )
  .openapi(
    createRoute({
      method: 'post', path: `${P}/runs/{id}/cancel`, tags, request: { params: BrandItemParams },
      responses: { 200: json(C.WatchRun), 404: E, 409: E },
    }),
    async (c) => {
      const { brandId, id } = c.req.valid('param');
      await cancelRun(brandId, id);
      return c.json(toRun(await withBrand(brandId, (tx) => getRun(tx, brandId, id))), 200);
    },
  )
  .openapi(
    createRoute({
      method: 'post', path: `${P}/runs/{id}/retry`, tags, request: { params: BrandItemParams },
      responses: { 200: json(C.WatchRun), 404: E, 409: E },
    }),
    async (c) => {
      const { brandId, id } = c.req.valid('param');
      await retryRun(brandId, id);
      return c.json(toRun(await withBrand(brandId, (tx) => getRun(tx, brandId, id))), 200);
    },
  )
  .openapi(
    createRoute({
      method: 'get', path: `${P}/schedule`, tags, request: { params: BrandParams },
      responses: { 200: json(C.Schedule), 404: E },
    }),
    async (c) => {
      const { brandId } = c.req.valid('param');
      return c.json(toSchedule(await withBrand(brandId, (tx) => getSchedule(tx, brandId))), 200);
    },
  )
  .openapi(
    createRoute({
      method: 'put', path: `${P}/schedule`, tags, request: { params: BrandParams, ...body(C.ScheduleUpdate) },
      responses: { 200: json(C.Schedule), 400: E, 404: E },
    }),
    async (c) => {
      const { brandId } = c.req.valid('param');
      return c.json(toSchedule(await withBrand(brandId, (tx) => setSchedule(tx, brandId, c.req.valid('json')))), 200);
    },
  )
  .openapi(
    createRoute({
      method: 'get', path: `${P}/observations`, tags, request: { params: BrandParams, query: C.ObservationsQuery },
      responses: { 200: json(z.array(C.Observation), 'Newest first'), 404: E },
    }),
    async (c) => {
      const { brandId } = c.req.valid('param');
      const rows = await withBrand(brandId, (tx) => listObservations(tx, brandId, c.req.valid('query')));
      return c.json(rows.map(toObservation), 200);
    },
  )
  .openapi(
    createRoute({
      method: 'get', path: `${P}/competitors/{competitorId}/profile`, tags, request: { params: CompetitorParams },
      responses: { 200: json(C.Profile), 404: E },
    }),
    async (c) => {
      const { brandId, competitorId } = c.req.valid('param');
      const p = await withBrand(brandId, (tx) => getProfile(tx, brandId, competitorId));
      return c.json({ competitorId: p.competitorId, runId: p.runId, createdAt: p.createdAt.toISOString(), entries: p.profile.entries, sourceIds: p.sourceIds }, 200);
    },
  )
  .openapi(
    createRoute({
      method: 'get', path: `${P}/opportunities`, tags, request: { params: BrandParams, query: C.OpportunitiesQuery },
      responses: { 200: json(z.array(C.Opportunity), 'Best first (impact, confidence, effort), newest first within a rank'), 404: E },
    }),
    async (c) => {
      const { brandId } = c.req.valid('param');
      return c.json((await withBrand(brandId, (tx) => listOpportunities(tx, brandId, c.req.valid('query').status))).map(toOpportunity), 200);
    },
  )
  .openapi(
    createRoute({
      method: 'post', path: `${P}/opportunities/{id}/accept`, tags, request: { params: BrandItemParams },
      responses: { 200: json(C.Opportunity), 404: E },
    }),
    async (c) => {
      const { brandId, id } = c.req.valid('param');
      return c.json(toOpportunity(await withBrand(brandId, (tx) => decideOpportunity(tx, brandId, id, 'accepted'))), 200);
    },
  )
  .openapi(
    createRoute({
      method: 'post', path: `${P}/opportunities/{id}/dismiss`, tags, request: { params: BrandItemParams },
      responses: { 200: json(C.Opportunity), 404: E },
    }),
    async (c) => {
      const { brandId, id } = c.req.valid('param');
      return c.json(toOpportunity(await withBrand(brandId, (tx) => decideOpportunity(tx, brandId, id, 'dismissed'))), 200);
    },
  )
  .openapi(
    createRoute({
      method: 'post', path: `${P}/opportunities/{id}/restore`, tags, request: { params: BrandItemParams },
      responses: { 200: json(C.Opportunity, 'Back to new'), 404: E, 409: E },
    }),
    async (c) => {
      const { brandId, id } = c.req.valid('param');
      return c.json(toOpportunity(await withBrand(brandId, (tx) => restoreOpportunity(tx, brandId, id))), 200);
    },
  )
  .openapi(
    createRoute({
      method: 'post', path: `${P}/opportunities/scan`, tags, request: { params: BrandParams },
      responses: { 200: json(C.OpportunityScanResult, 'From every observation, profile, candidate and fact'), 400: E, 402: E, 404: E },
    }),
    async (c) => {
      const { brandId } = c.req.valid('param');
      const { created, dropped } = await scanOpportunities(brandId);
      return c.json({ created: created.map(toOpportunity), dropped }, 200);
    },
  )
  .openapi(
    createRoute({
      method: 'get', path: `${P}/competitors/{competitorId}/battlecard`, tags, request: { params: CompetitorParams },
      responses: { 200: json(C.BattlecardPair), 404: E },
    }),
    async (c) => {
      const { brandId, competitorId } = c.req.valid('param');
      const pair = await withBrand(brandId, (tx) => getBattlecards(tx, brandId, competitorId));
      return c.json({ approved: pair.approved && toBattlecard(pair.approved), draft: pair.draft && toBattlecard(pair.draft) }, 200);
    },
  )
  .openapi(
    createRoute({
      method: 'post', path: `${P}/competitors/{competitorId}/battlecard/generate`, tags, request: { params: CompetitorParams },
      responses: { 201: json(C.Battlecard, 'A new draft version'), 404: E },
    }),
    async (c) => {
      const { brandId, competitorId } = c.req.valid('param');
      const facts = await withBrand(brandId, (tx) => approvedFacts(tx, brandId));
      return c.json(toBattlecard(await generateBattlecard(brandId, competitorId, facts)), 201);
    },
  )
  .openapi(
    createRoute({
      method: 'post', path: `${P}/competitors/{competitorId}/battlecard/approve`, tags, request: { params: CompetitorParams },
      responses: { 200: json(C.Battlecard), 404: E, 409: E },
    }),
    async (c) => {
      const { brandId, competitorId } = c.req.valid('param');
      return c.json(toBattlecard(await withBrand(brandId, (tx) => approveBattlecard(tx, brandId, competitorId))), 200);
    },
  );
