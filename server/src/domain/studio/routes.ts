import { createRoute, z } from '@hono/zod-openapi';
import * as C from '../../contracts/studio.ts';
import { BrandItemParams, BrandParams } from '../../http/brand.ts';
import { HttpError } from '../../http/errors.ts';
import { errorResponse as E, createRouter, json } from '../../http/router.ts';

const tags = ['studio'];
const P = '/brands/{brandId}/studio';
const body = <T extends z.ZodType>(schema: T) => ({ body: { required: true, content: { 'application/json': { schema } } } });
const todo = (): never => {
  throw new HttpError(501, 'not_implemented', 'Not built yet');
};

export const routes = createRouter()
  .openapi(createRoute({ method: 'get', path: `${P}/overview`, tags, request: { params: BrandParams, query: C.OverviewQuery }, responses: { 200: json(C.Overview), 400: E, 404: E } }), todo)
  .openapi(createRoute({ method: 'get', path: `${P}/templates`, tags, request: { params: BrandParams }, responses: { 200: json(C.TemplateList), 404: E } }), todo)
  .openapi(createRoute({ method: 'post', path: `${P}/drafts/estimate`, tags, request: { params: BrandParams, ...body(C.DraftCreate) }, responses: { 200: json(C.Estimate), 400: E, 404: E, 409: E } }), todo)
  .openapi(createRoute({ method: 'post', path: `${P}/drafts`, tags, request: { params: BrandParams, ...body(C.DraftCreate) }, responses: { 201: json(C.StudioRun, 'Started'), 400: E, 402: E, 404: E, 409: E } }), todo)
  .openapi(createRoute({ method: 'get', path: `${P}/drafts/{id}`, tags, request: { params: BrandItemParams }, responses: { 200: json(C.DraftView), 404: E } }), todo)
  .openapi(createRoute({ method: 'patch', path: `${P}/drafts/{id}`, tags, request: { params: BrandItemParams, ...body(C.ContentPatch) }, responses: { 200: json(C.DraftView, 'The edit is the new current version'), 400: E, 404: E, 409: E } }), todo)
  .openapi(createRoute({ method: 'post', path: `${P}/drafts/{id}/render`, tags, request: { params: BrandItemParams }, responses: { 201: json(C.StudioRun, 'Started. Costs NPR 0.'), 404: E, 409: E } }), todo)
  .openapi(createRoute({ method: 'post', path: `${P}/drafts/{id}/ready`, tags, request: { params: BrandItemParams }, responses: { 200: json(C.DraftView), 404: E, 409: E } }), todo)
  .openapi(createRoute({ method: 'get', path: `${P}/runs/{id}`, tags, request: { params: BrandItemParams }, responses: { 200: json(C.StudioRun), 404: E } }), todo)
  .openapi(createRoute({ method: 'post', path: `${P}/runs/{id}/cancel`, tags, request: { params: BrandItemParams }, responses: { 200: json(C.StudioRun), 404: E, 409: E } }), todo)
  .openapi(createRoute({ method: 'post', path: `${P}/runs/{id}/retry`, tags, request: { params: BrandItemParams }, responses: { 200: json(C.StudioRun), 404: E, 409: E } }), todo);
