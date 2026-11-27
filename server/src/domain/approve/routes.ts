import { createRoute, z } from '@hono/zod-openapi';
import * as C from '../../contracts/approve.ts';
import { ErrorBody } from '../../contracts/common.ts';
import { withBrand } from '../../db/tenant.ts';
import { BrandParams } from '../../http/brand.ts';
import { errorResponse as E, createRouter, json } from '../../http/router.ts';
import { approvedFacts } from '../knowledge/index.ts';
import { approve, bulkApprove, reject } from './decisions.ts';
import { preview, queue, toDecision } from './queue.ts';
import { getSettings, setPaused, setSettings, type ApproveSettings } from './settings.ts';
import { studioReads } from './studio.ts';

const tags = ['approve'];
const P = '/brands/{brandId}/approve';
const body = <T extends z.ZodType>(schema: T) => ({ body: { required: true, content: { 'application/json': { schema } } } });
const DraftParams = BrandParams.extend({ draftId: z.string().openapi({ param: { name: 'draftId', in: 'path' } }) });
const conflict = json(ErrorBody, 'Refused. The message `changed since you opened it` means the draft changed: reload the preview.');

/** Where the routes get Studio from. Tests swap reads for a fake, as with fetchGuard. */
export const routeStudio = { reads: studioReads };

const toSettings = (s: ApproveSettings): z.infer<typeof C.SettingsView> => ({ ...s, pausedAt: s.pausedAt?.toISOString() ?? null });

export const routes = createRouter()
  .openapi(
    createRoute({ method: 'get', path: `${P}/summary`, tags, request: { params: BrandParams }, responses: { 200: json(C.Summary), 404: E } }),
    async (c) => {
      const { brandId } = c.req.valid('param');
      const q = await withBrand(brandId, async (tx) => queue(tx, brandId, await approvedFacts(tx, brandId), await routeStudio.reads()));
      return c.json(q.summary, 200);
    },
  )
  .openapi(
    createRoute({ method: 'get', path: `${P}/queue`, tags, request: { params: BrandParams, query: C.QueueQuery }, responses: { 200: json(C.Queue), 400: E, 404: E } }),
    async (c) => {
      const { brandId } = c.req.valid('param');
      const { state } = c.req.valid('query');
      return c.json(await withBrand(brandId, async (tx) => queue(tx, brandId, await approvedFacts(tx, brandId), await routeStudio.reads(), { state })), 200);
    },
  )
  .openapi(
    createRoute({ method: 'get', path: `${P}/queue/{draftId}`, tags, request: { params: DraftParams }, responses: { 200: json(C.Preview), 404: E } }),
    async (c) => {
      const { brandId, draftId } = c.req.valid('param');
      return c.json(await withBrand(brandId, async (tx) => preview(tx, brandId, draftId, await approvedFacts(tx, brandId), await routeStudio.reads(), { record: true })), 200);
    },
  )
  .openapi(
    createRoute({ method: 'post', path: `${P}/queue/{draftId}/approve`, tags, request: { params: DraftParams, ...body(C.ApproveBody) }, responses: { 200: json(C.Preview, 'Approved'), 400: E, 404: E, 409: conflict } }),
    async (c) => {
      const { brandId, draftId } = c.req.valid('param');
      const view = await withBrand(brandId, async (tx) => {
        const [f, s] = [await approvedFacts(tx, brandId), await routeStudio.reads()];
        await approve(tx, brandId, { ...c.req.valid('json'), draftId }, f, s);
        return preview(tx, brandId, draftId, f, s, { record: false });
      });
      return c.json(view, 200);
    },
  )
  .openapi(
    createRoute({ method: 'post', path: `${P}/queue/{draftId}/reject`, tags, request: { params: DraftParams, ...body(C.RejectBody) }, responses: { 200: json(C.Preview, 'Rejected'), 400: E, 404: E, 409: conflict } }),
    async (c) => {
      const { brandId, draftId } = c.req.valid('param');
      const view = await withBrand(brandId, async (tx) => {
        const [f, s] = [await approvedFacts(tx, brandId), await routeStudio.reads()];
        await reject(tx, brandId, { ...c.req.valid('json'), draftId }, f, s);
        return preview(tx, brandId, draftId, f, s, { record: false });
      });
      return c.json(view, 200);
    },
  )
  .openapi(
    createRoute({ method: 'post', path: `${P}/bulk-approve`, tags, request: { params: BrandParams, ...body(C.BulkBody) }, responses: { 200: json(C.BulkResult, 'Every item approved'), 400: E, 404: E, 409: conflict } }),
    async (c) => {
      const { brandId } = c.req.valid('param');
      const done = await withBrand(brandId, async (tx) => bulkApprove(tx, brandId, c.req.valid('json').items, await approvedFacts(tx, brandId), await routeStudio.reads()));
      return c.json({ bulkId: done[0]!.bulkId!, decisions: done.map(toDecision) }, 200);
    },
  )
  .openapi(
    createRoute({ method: 'get', path: `${P}/settings`, tags, request: { params: BrandParams }, responses: { 200: json(C.SettingsView), 404: E } }),
    async (c) => {
      const { brandId } = c.req.valid('param');
      return c.json(toSettings(await withBrand(brandId, (tx) => getSettings(tx, brandId))), 200);
    },
  )
  .openapi(
    createRoute({ method: 'put', path: `${P}/settings`, tags, request: { params: BrandParams, ...body(C.Settings) }, responses: { 200: json(C.SettingsView), 400: E, 404: E } }),
    async (c) => {
      const { brandId } = c.req.valid('param');
      return c.json(toSettings(await withBrand(brandId, (tx) => setSettings(tx, brandId, c.req.valid('json')))), 200);
    },
  )
  .openapi(
    createRoute({ method: 'post', path: `${P}/pause`, tags, request: { params: BrandParams, ...body(C.PauseBody) }, responses: { 200: json(C.SettingsView, 'Paused: no approval is valid until resumed'), 400: E, 404: E } }),
    async (c) => {
      const { brandId } = c.req.valid('param');
      return c.json(toSettings(await withBrand(brandId, (tx) => setPaused(tx, brandId, true, c.req.valid('json').reason))), 200);
    },
  )
  .openapi(
    createRoute({ method: 'post', path: `${P}/resume`, tags, request: { params: BrandParams, ...body(C.PauseBody) }, responses: { 200: json(C.SettingsView, 'Resumed'), 400: E, 404: E } }),
    async (c) => {
      const { brandId } = c.req.valid('param');
      return c.json(toSettings(await withBrand(brandId, (tx) => setPaused(tx, brandId, false, c.req.valid('json').reason))), 200);
    },
  );
