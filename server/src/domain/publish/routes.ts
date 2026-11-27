import { createRoute, z } from '@hono/zod-openapi';
import * as C from '../../contracts/publish.ts';
import { BrandItemParams, BrandParams } from '../../http/brand.ts';
import { HttpError } from '../../http/errors.ts';
import { errorResponse as E, createRouter, json } from '../../http/router.ts';

const tags = ['publish'];
const P = '/brands/{brandId}/publish';
const body = <T extends z.ZodType>(schema: T) => ({ body: { required: true, content: { 'application/json': { schema } } } });
const todo = (): never => {
  throw new HttpError(501, 'not_implemented', 'Not built yet');
};

export const routes = createRouter()
  .openapi(createRoute({ method: 'get', path: `${P}/summary`, tags, request: { params: BrandParams }, responses: { 200: json(C.Summary), 404: E } }), todo)
  .openapi(createRoute({ method: 'get', path: `${P}/channels`, tags, request: { params: BrandParams }, responses: { 200: json(z.array(C.Channel), 'By platform, then account name'), 404: E } }), todo)
  .openapi(createRoute({ method: 'post', path: `${P}/channels`, tags, request: { params: BrandParams, ...body(C.ChannelCreate) }, responses: { 201: json(C.Channel, 'Created'), 400: E, 404: E, 409: E } }), todo)
  .openapi(createRoute({ method: 'patch', path: `${P}/channels/{id}`, tags, request: { params: BrandItemParams, ...body(C.ChannelPatch) }, responses: { 200: json(C.Channel), 400: E, 404: E, 409: E } }), todo)
  .openapi(createRoute({ method: 'get', path: `${P}/capabilities`, tags, request: { params: BrandParams }, responses: { 200: json(z.array(C.Capability)), 404: E } }), todo)
  .openapi(createRoute({ method: 'get', path: `${P}/schedulable`, tags, request: { params: BrandParams }, responses: { 200: json(C.Schedulable), 404: E } }), todo)
  .openapi(createRoute({ method: 'get', path: `${P}/jobs`, tags, request: { params: BrandParams, query: C.JobsQuery }, responses: { 200: json(C.JobList), 400: E, 404: E } }), todo)
  .openapi(createRoute({ method: 'post', path: `${P}/jobs`, tags, request: { params: BrandParams, ...body(C.JobCreate) }, responses: { 201: json(C.Job, 'Scheduled'), 400: E, 404: E, 409: E } }), todo)
  .openapi(createRoute({ method: 'get', path: `${P}/jobs/{id}`, tags, request: { params: BrandItemParams }, responses: { 200: json(C.JobDetail), 404: E } }), todo)
  .openapi(createRoute({ method: 'post', path: `${P}/jobs/{id}/cancel`, tags, request: { params: BrandItemParams }, responses: { 200: json(C.Job), 404: E, 409: E } }), todo)
  .openapi(createRoute({ method: 'post', path: `${P}/jobs/{id}/reschedule`, tags, request: { params: BrandItemParams, ...body(C.Reschedule) }, responses: { 200: json(C.Job), 400: E, 404: E, 409: E } }), todo)
  .openapi(createRoute({ method: 'post', path: `${P}/jobs/{id}/retry`, tags, request: { params: BrandItemParams }, responses: { 200: json(C.Job, 'Scheduled to send within a minute'), 404: E, 409: E } }), todo)
  .openapi(createRoute({ method: 'post', path: `${P}/jobs/{id}/confirm-manual`, tags, request: { params: BrandItemParams, ...body(C.ConfirmManual) }, responses: { 200: json(C.Job), 400: E, 404: E, 409: E } }), todo)
  .openapi(createRoute({ method: 'post', path: `${P}/jobs/{id}/resolve-unknown`, tags, request: { params: BrandItemParams, ...body(C.ResolveUnknown) }, responses: { 200: json(C.Job), 400: E, 404: E, 409: E } }), todo)
  .openapi(createRoute({ method: 'get', path: `${P}/settings`, tags, request: { params: BrandParams }, responses: { 200: json(C.Settings), 404: E } }), todo)
  .openapi(createRoute({ method: 'put', path: `${P}/settings`, tags, request: { params: BrandParams, ...body(C.Settings) }, responses: { 200: json(C.Settings), 400: E, 404: E } }), todo);
