import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import * as C from '../../contracts/research.ts';
import { withBrand } from '../../db/tenant.ts';
import { BrandItemParams, BrandParams } from '../../http/brand.ts';
import { errorBody, NotFoundError } from '../../http/errors.ts';
import { createRouter, errorResponse, json } from '../../http/router.ts';
import { listCompetitors } from '../brands/index.ts';
import { addTarget, listTargets, removeTarget, setTargetStatus, suggestTargets, type WatchTarget } from './targets.ts';

const tags = ['research'];
const P = '/brands/{brandId}/research';
const CompetitorParams = BrandParams.extend({
  competitorId: z.string().openapi({ param: { name: 'competitorId', in: 'path' } }),
});
const body = <T extends z.ZodType>(schema: T) => ({ body: { required: true, content: { 'application/json': { schema } } } });
const E = errorResponse;
// Handlers whose domain function is not built yet answer 501 in the base error shape.
const stub = (c: Context) => c.json(errorBody('not_implemented', 'Not implemented yet'), 501 as const);

const toTarget = (t: WatchTarget): z.infer<typeof C.WatchTarget> => ({
  id: t.id, competitorId: t.competitorId, url: t.url, label: t.label, status: t.status, failCount: t.failCount,
  lastError: t.lastError, lastSourceId: t.lastSourceId, createdAt: t.createdAt.toISOString(),
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
      responses: { 200: json(z.array(C.WatchRun), 'Newest first'), 404: E, 501: E },
    }),
    (c) => stub(c),
  )
  .openapi(
    createRoute({
      method: 'post', path: `${P}/runs`, tags, request: { params: BrandParams, ...body(C.RunCreate) },
      responses: { 201: json(C.WatchRun, 'Started'), 404: E, 409: E, 501: E },
    }),
    (c) => stub(c),
  )
  .openapi(
    createRoute({
      method: 'get', path: `${P}/runs/{id}`, tags, request: { params: BrandItemParams },
      responses: { 200: json(C.WatchRun), 404: E, 501: E },
    }),
    (c) => stub(c),
  )
  .openapi(
    createRoute({
      method: 'post', path: `${P}/runs/{id}/confirm`, tags, request: { params: BrandItemParams },
      responses: { 200: json(C.WatchRun), 404: E, 409: E, 501: E },
    }),
    (c) => stub(c),
  )
  .openapi(
    createRoute({
      method: 'post', path: `${P}/runs/{id}/cancel`, tags, request: { params: BrandItemParams },
      responses: { 200: json(C.WatchRun), 404: E, 409: E, 501: E },
    }),
    (c) => stub(c),
  )
  .openapi(
    createRoute({
      method: 'post', path: `${P}/runs/{id}/retry`, tags, request: { params: BrandItemParams },
      responses: { 200: json(C.WatchRun), 404: E, 409: E, 501: E },
    }),
    (c) => stub(c),
  )
  .openapi(
    createRoute({
      method: 'get', path: `${P}/schedule`, tags, request: { params: BrandParams },
      responses: { 200: json(C.Schedule), 404: E, 501: E },
    }),
    (c) => stub(c),
  )
  .openapi(
    createRoute({
      method: 'put', path: `${P}/schedule`, tags, request: { params: BrandParams, ...body(C.ScheduleUpdate) },
      responses: { 200: json(C.Schedule), 400: E, 404: E, 501: E },
    }),
    (c) => stub(c),
  )
  .openapi(
    createRoute({
      method: 'get', path: `${P}/observations`, tags, request: { params: BrandParams, query: C.ObservationsQuery },
      responses: { 200: json(z.array(C.Observation), 'Newest first'), 404: E, 501: E },
    }),
    (c) => stub(c),
  )
  .openapi(
    createRoute({
      method: 'get', path: `${P}/competitors/{competitorId}/profile`, tags, request: { params: CompetitorParams },
      responses: { 200: json(C.Profile), 404: E, 501: E },
    }),
    (c) => stub(c),
  )
  .openapi(
    createRoute({
      method: 'get', path: `${P}/opportunities`, tags, request: { params: BrandParams, query: C.OpportunitiesQuery },
      responses: { 200: json(z.array(C.Opportunity), 'Newest first'), 404: E, 501: E },
    }),
    (c) => stub(c),
  )
  .openapi(
    createRoute({
      method: 'post', path: `${P}/opportunities/{id}/accept`, tags, request: { params: BrandItemParams },
      responses: { 200: json(C.Opportunity), 404: E, 501: E },
    }),
    (c) => stub(c),
  )
  .openapi(
    createRoute({
      method: 'post', path: `${P}/opportunities/{id}/dismiss`, tags, request: { params: BrandItemParams },
      responses: { 200: json(C.Opportunity), 404: E, 501: E },
    }),
    (c) => stub(c),
  )
  .openapi(
    createRoute({
      method: 'get', path: `${P}/competitors/{competitorId}/battlecard`, tags, request: { params: CompetitorParams },
      responses: { 200: json(C.BattlecardPair), 404: E, 501: E },
    }),
    (c) => stub(c),
  )
  .openapi(
    createRoute({
      method: 'post', path: `${P}/competitors/{competitorId}/battlecard/generate`, tags, request: { params: CompetitorParams },
      responses: { 201: json(C.Battlecard, 'A new draft version'), 404: E, 501: E },
    }),
    (c) => stub(c),
  )
  .openapi(
    createRoute({
      method: 'post', path: `${P}/competitors/{competitorId}/battlecard/approve`, tags, request: { params: CompetitorParams },
      responses: { 200: json(C.Battlecard), 404: E, 409: E, 501: E },
    }),
    (c) => stub(c),
  );
