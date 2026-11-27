import { createRoute, z } from '@hono/zod-openapi';
import * as C from '../../contracts/approve.ts';
import { ErrorBody } from '../../contracts/common.ts';
import { BrandParams } from '../../http/brand.ts';
import { HttpError } from '../../http/errors.ts';
import { errorResponse as E, createRouter, json } from '../../http/router.ts';

const tags = ['approve'];
const P = '/brands/{brandId}/approve';
const body = <T extends z.ZodType>(schema: T) => ({ body: { required: true, content: { 'application/json': { schema } } } });
const DraftParams = BrandParams.extend({ draftId: z.string().openapi({ param: { name: 'draftId', in: 'path' } }) });
const conflict = json(ErrorBody, 'Refused. The message `changed since you opened it` means the draft changed: reload the preview.');
const todo = (): never => {
  throw new HttpError(501, 'not_implemented', 'Not built yet');
};

export const routes = createRouter()
  .openapi(createRoute({ method: 'get', path: `${P}/summary`, tags, request: { params: BrandParams }, responses: { 200: json(C.Summary), 404: E } }), todo)
  .openapi(createRoute({ method: 'get', path: `${P}/queue`, tags, request: { params: BrandParams, query: C.QueueQuery }, responses: { 200: json(C.Queue), 400: E, 404: E } }), todo)
  .openapi(createRoute({ method: 'get', path: `${P}/queue/{draftId}`, tags, request: { params: DraftParams }, responses: { 200: json(C.Preview), 404: E } }), todo)
  .openapi(createRoute({ method: 'post', path: `${P}/queue/{draftId}/approve`, tags, request: { params: DraftParams, ...body(C.ApproveBody) }, responses: { 200: json(C.Preview, 'Approved'), 400: E, 404: E, 409: conflict } }), todo)
  .openapi(createRoute({ method: 'post', path: `${P}/queue/{draftId}/reject`, tags, request: { params: DraftParams, ...body(C.RejectBody) }, responses: { 200: json(C.Preview, 'Rejected'), 400: E, 404: E, 409: conflict } }), todo)
  .openapi(createRoute({ method: 'post', path: `${P}/bulk-approve`, tags, request: { params: BrandParams, ...body(C.BulkBody) }, responses: { 200: json(C.BulkResult, 'Every item approved'), 400: E, 404: E, 409: conflict } }), todo)
  .openapi(createRoute({ method: 'get', path: `${P}/settings`, tags, request: { params: BrandParams }, responses: { 200: json(C.SettingsView), 404: E } }), todo)
  .openapi(createRoute({ method: 'put', path: `${P}/settings`, tags, request: { params: BrandParams, ...body(C.Settings) }, responses: { 200: json(C.SettingsView), 400: E, 404: E } }), todo)
  .openapi(createRoute({ method: 'post', path: `${P}/pause`, tags, request: { params: BrandParams, ...body(C.PauseBody) }, responses: { 200: json(C.SettingsView, 'Paused: no approval is valid until resumed'), 400: E, 404: E } }), todo)
  .openapi(createRoute({ method: 'post', path: `${P}/resume`, tags, request: { params: BrandParams, ...body(C.PauseBody) }, responses: { 200: json(C.SettingsView, 'Resumed'), 400: E, 404: E } }), todo);
