import { createRoute, z } from '@hono/zod-openapi';
import * as C from '../../contracts/plan.ts';
import { BrandItemParams, BrandParams } from '../../http/brand.ts';
import { errorBody } from '../../http/errors.ts';
import { createRouter, errorResponse as E, json } from '../../http/router.ts';

const tags = ['plan'];
const P = '/brands/{brandId}/plan';
const body = <T extends z.ZodType>(schema: T) => ({ body: { required: true, content: { 'application/json': { schema } } } });
const WeekParams = BrandParams.extend(C.WeekParams.shape);
const notYet = { 501: E };

export const routes = createRouter()
  .openapi(
    createRoute({ method: 'get', path: `${P}/overview`, tags, request: { params: BrandParams }, responses: { 200: json(C.Overview), 404: E, ...notYet } }),
    (c) => c.json(errorBody('not_implemented', 'Not built yet'), 501),
  )
  .openapi(
    createRoute({ method: 'get', path: `${P}/settings`, tags, request: { params: BrandParams }, responses: { 200: json(C.Settings), 404: E, ...notYet } }),
    (c) => c.json(errorBody('not_implemented', 'Not built yet'), 501),
  )
  .openapi(
    createRoute({ method: 'put', path: `${P}/settings`, tags, request: { params: BrandParams, ...body(C.Settings) }, responses: { 200: json(C.Settings), 400: E, 404: E, ...notYet } }),
    (c) => c.json(errorBody('not_implemented', 'Not built yet'), 501),
  )
  .openapi(
    createRoute({ method: 'get', path: `${P}/campaigns`, tags, request: { params: BrandParams, query: C.CampaignsQuery }, responses: { 200: json(z.array(C.Campaign), 'Newest first'), 404: E, ...notYet } }),
    (c) => c.json(errorBody('not_implemented', 'Not built yet'), 501),
  )
  .openapi(
    createRoute({ method: 'post', path: `${P}/campaigns`, tags, request: { params: BrandParams, ...body(C.CampaignCreate) }, responses: { 201: json(C.Campaign, 'Created'), 400: E, 404: E, ...notYet } }),
    (c) => c.json(errorBody('not_implemented', 'Not built yet'), 501),
  )
  .openapi(
    createRoute({ method: 'get', path: `${P}/campaigns/{id}`, tags, request: { params: BrandItemParams }, responses: { 200: json(C.Campaign), 404: E, ...notYet } }),
    (c) => c.json(errorBody('not_implemented', 'Not built yet'), 501),
  )
  .openapi(
    createRoute({ method: 'patch', path: `${P}/campaigns/{id}`, tags, request: { params: BrandItemParams, ...body(C.CampaignPatch) }, responses: { 200: json(C.Campaign), 400: E, 404: E, ...notYet } }),
    (c) => c.json(errorBody('not_implemented', 'Not built yet'), 501),
  )
  .openapi(
    createRoute({ method: 'get', path: `${P}/campaigns/{id}/brief`, tags, request: { params: BrandItemParams }, responses: { 200: json(C.BriefView), 404: E, ...notYet } }),
    (c) => c.json(errorBody('not_implemented', 'Not built yet'), 501),
  )
  .openapi(
    createRoute({ method: 'patch', path: `${P}/campaigns/{id}/brief`, tags, request: { params: BrandItemParams, ...body(C.BriefEdit) }, responses: { 200: json(C.BriefView, 'The edit is now the draft'), 400: E, 404: E, ...notYet } }),
    (c) => c.json(errorBody('not_implemented', 'Not built yet'), 501),
  )
  .openapi(
    createRoute({ method: 'post', path: `${P}/campaigns/{id}/brief/estimate`, tags, request: { params: BrandItemParams }, responses: { 200: json(C.Estimate), 400: E, 404: E, ...notYet } }),
    (c) => c.json(errorBody('not_implemented', 'Not built yet'), 501),
  )
  .openapi(
    createRoute({ method: 'post', path: `${P}/campaigns/{id}/brief/generate`, tags, request: { params: BrandItemParams }, responses: { 201: json(C.PlanRun, 'Started'), 400: E, 402: E, 404: E, 409: E, ...notYet } }),
    (c) => c.json(errorBody('not_implemented', 'Not built yet'), 501),
  )
  .openapi(
    createRoute({ method: 'post', path: `${P}/campaigns/{id}/brief/approve`, tags, request: { params: BrandItemParams }, responses: { 200: json(C.BriefView), 404: E, 409: E, ...notYet } }),
    (c) => c.json(errorBody('not_implemented', 'Not built yet'), 501),
  )
  .openapi(
    createRoute({ method: 'get', path: `${P}/weeks/{weekStart}`, tags, request: { params: WeekParams }, responses: { 200: json(C.WeekView), 400: E, 404: E, ...notYet } }),
    (c) => c.json(errorBody('not_implemented', 'Not built yet'), 501),
  )
  .openapi(
    createRoute({ method: 'post', path: `${P}/weeks/{weekStart}/estimate`, tags, request: { params: WeekParams }, responses: { 200: json(C.Estimate), 400: E, 404: E, ...notYet } }),
    (c) => c.json(errorBody('not_implemented', 'Not built yet'), 501),
  )
  .openapi(
    createRoute({ method: 'post', path: `${P}/weeks/{weekStart}/draft`, tags, request: { params: WeekParams }, responses: { 201: json(C.PlanRun, 'Started'), 400: E, 402: E, 404: E, 409: E, ...notYet } }),
    (c) => c.json(errorBody('not_implemented', 'Not built yet'), 501),
  )
  .openapi(
    createRoute({ method: 'post', path: `${P}/weeks/{weekStart}/approve`, tags, request: { params: WeekParams }, responses: { 200: json(C.WeekView), 400: E, 404: E, 409: E, ...notYet } }),
    (c) => c.json(errorBody('not_implemented', 'Not built yet'), 501),
  )
  .openapi(
    createRoute({ method: 'post', path: `${P}/weeks/{weekStart}/items`, tags, request: { params: WeekParams, ...body(C.ItemCreate) }, responses: { 201: json(C.ItemResult, 'Created'), 400: E, 404: E, ...notYet } }),
    (c) => c.json(errorBody('not_implemented', 'Not built yet'), 501),
  )
  .openapi(
    createRoute({ method: 'patch', path: `${P}/items/{id}`, tags, request: { params: BrandItemParams, ...body(C.ItemPatch) }, responses: { 200: json(C.ItemResult), 400: E, 404: E, ...notYet } }),
    (c) => c.json(errorBody('not_implemented', 'Not built yet'), 501),
  )
  .openapi(
    createRoute({ method: 'delete', path: `${P}/items/{id}`, tags, request: { params: BrandItemParams }, responses: { 200: json(C.ItemRemoved), 404: E, ...notYet } }),
    (c) => c.json(errorBody('not_implemented', 'Not built yet'), 501),
  )
  .openapi(
    createRoute({ method: 'get', path: `${P}/runs/{id}`, tags, request: { params: BrandItemParams }, responses: { 200: json(C.PlanRun), 404: E, ...notYet } }),
    (c) => c.json(errorBody('not_implemented', 'Not built yet'), 501),
  )
  .openapi(
    createRoute({ method: 'post', path: `${P}/runs/{id}/cancel`, tags, request: { params: BrandItemParams }, responses: { 200: json(C.PlanRun), 404: E, 409: E, ...notYet } }),
    (c) => c.json(errorBody('not_implemented', 'Not built yet'), 501),
  )
  .openapi(
    createRoute({ method: 'post', path: `${P}/runs/{id}/retry`, tags, request: { params: BrandItemParams }, responses: { 200: json(C.PlanRun), 404: E, 409: E, ...notYet } }),
    (c) => c.json(errorBody('not_implemented', 'Not built yet'), 501),
  );
