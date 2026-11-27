import { createRoute, z } from '@hono/zod-openapi';
import * as C from '../../contracts/publish.ts';
import { withBrand, type Tx } from '../../db/tenant.ts';
import { BrandItemParams, BrandParams } from '../../http/brand.ts';
import { errorResponse as E, createRouter, json } from '../../http/router.ts';
import { approvedFacts } from '../knowledge/index.ts';
import { CAPABILITIES, platforms } from './capabilities.ts';
import { createChannel, listChannels, updateChannel, type Channel } from './channels.ts';
import type { Job } from './jobs.ts';
import { confirmManual, resolveUnknown, retryJob } from './manual.ts';
import { reads, type Reads } from './reads.ts';
import { cancelJob, rescheduleJob, scheduleJob } from './schedule.ts';
import { getSettings, setSettings } from './settings.ts';
import { jobDetail, jobViews, listJobs, schedulable, summary } from './summary.ts';
import type { ApprovedFact } from '../../contracts/common.ts';

const tags = ['publish'];
const P = '/brands/{brandId}/publish';
const body = <T extends z.ZodType>(schema: T) => ({ body: { required: true, content: { 'application/json': { schema } } } });

const toChannel = (c: Channel): z.infer<typeof C.Channel> => ({
  id: c.id, platform: c.platform, mode: c.mode, connector: c.connector, accountName: c.accountName, accountUrl: c.accountUrl,
  status: c.status, lastVerifiedAt: c.lastVerifiedAt?.toISOString() ?? null, createdAt: c.createdAt.toISOString(),
});

/** Runs fn in the brand's transaction with Approve and Studio's reads and today's approved facts. */
const withReads = async <T>(brandId: string, fn: (tx: Tx, r: Reads, facts: ApprovedFact[]) => Promise<T>) => {
  const r = await reads();
  return withBrand(brandId, async (tx) => fn(tx, r, await approvedFacts(tx, brandId)));
};
/** An action on one job, answered with the job as the screens show it. */
const jobAction = (brandId: string, fn: (tx: Tx, r: Reads, facts: ApprovedFact[]) => Promise<Job>) =>
  withReads(brandId, async (tx, r, facts) => (await jobViews(tx, brandId, [await fn(tx, r, facts)], r, facts))[0]!);

export const routes = createRouter()
  .openapi(createRoute({ method: 'get', path: `${P}/summary`, tags, request: { params: BrandParams }, responses: { 200: json(C.Summary), 404: E } }), async (c) => {
    const { brandId } = c.req.valid('param');
    return c.json(await withReads(brandId, (tx, r, f) => summary(tx, brandId, r, f)), 200);
  })
  .openapi(createRoute({ method: 'get', path: `${P}/channels`, tags, request: { params: BrandParams }, responses: { 200: json(z.array(C.Channel), 'By platform, then account name'), 404: E } }), async (c) => {
    const { brandId } = c.req.valid('param');
    return c.json((await withBrand(brandId, (tx) => listChannels(tx, brandId))).map(toChannel), 200);
  })
  .openapi(createRoute({ method: 'post', path: `${P}/channels`, tags, request: { params: BrandParams, ...body(C.ChannelCreate) }, responses: { 201: json(C.Channel, 'Created'), 400: E, 404: E, 409: E } }), async (c) => {
    const { brandId } = c.req.valid('param');
    return c.json(toChannel(await withBrand(brandId, (tx) => createChannel(tx, brandId, { ...c.req.valid('json'), connector: 'manual' }))), 201);
  })
  .openapi(createRoute({ method: 'patch', path: `${P}/channels/{id}`, tags, request: { params: BrandItemParams, ...body(C.ChannelPatch) }, responses: { 200: json(C.Channel), 400: E, 404: E, 409: E } }), async (c) => {
    const { brandId, id } = c.req.valid('param');
    return c.json(toChannel(await withBrand(brandId, (tx) => updateChannel(tx, brandId, id, c.req.valid('json')))), 200);
  })
  .openapi(createRoute({ method: 'get', path: `${P}/capabilities`, tags, request: { params: BrandParams }, responses: { 200: json(z.array(C.Capability)), 404: E } }), async (c) => {
    const { brandId } = c.req.valid('param');
    await withBrand(brandId, async () => undefined);
    return c.json(platforms.map((p) => ({ platform: p, ...CAPABILITIES[p], verified: CAPABILITIES[p].lastVerified !== null })), 200);
  })
  .openapi(createRoute({ method: 'get', path: `${P}/schedulable`, tags, request: { params: BrandParams }, responses: { 200: json(C.Schedulable), 404: E } }), async (c) => {
    const { brandId } = c.req.valid('param');
    return c.json(await withReads(brandId, (tx, r, f) => schedulable(tx, brandId, r, f)), 200);
  })
  .openapi(createRoute({ method: 'get', path: `${P}/jobs`, tags, request: { params: BrandParams, query: C.JobsQuery }, responses: { 200: json(C.JobList), 400: E, 404: E } }), async (c) => {
    const { brandId } = c.req.valid('param');
    return c.json(await withReads(brandId, (tx, r, f) => listJobs(tx, brandId, c.req.valid('query'), r, f)), 200);
  })
  .openapi(createRoute({ method: 'post', path: `${P}/jobs`, tags, request: { params: BrandParams, ...body(C.JobCreate) }, responses: { 201: json(C.Job, 'Scheduled'), 400: E, 404: E, 409: E } }), async (c) => {
    const { brandId } = c.req.valid('param');
    return c.json(await jobAction(brandId, (tx, r, f) => scheduleJob(tx, brandId, c.req.valid('json'), f, r)), 201);
  })
  .openapi(createRoute({ method: 'get', path: `${P}/jobs/{id}`, tags, request: { params: BrandItemParams }, responses: { 200: json(C.JobDetail), 404: E } }), async (c) => {
    const { brandId, id } = c.req.valid('param');
    return c.json(await withReads(brandId, (tx, r, f) => jobDetail(tx, brandId, id, r, f)), 200);
  })
  .openapi(createRoute({ method: 'post', path: `${P}/jobs/{id}/cancel`, tags, request: { params: BrandItemParams }, responses: { 200: json(C.Job), 404: E, 409: E } }), async (c) => {
    const { brandId, id } = c.req.valid('param');
    return c.json(await jobAction(brandId, (tx) => cancelJob(tx, brandId, id)), 200);
  })
  .openapi(createRoute({ method: 'post', path: `${P}/jobs/{id}/reschedule`, tags, request: { params: BrandItemParams, ...body(C.Reschedule) }, responses: { 200: json(C.Job), 400: E, 404: E, 409: E } }), async (c) => {
    const { brandId, id } = c.req.valid('param');
    return c.json(await jobAction(brandId, (tx, r) => rescheduleJob(tx, brandId, id, c.req.valid('json').scheduledAt, r)), 200);
  })
  .openapi(createRoute({ method: 'post', path: `${P}/jobs/{id}/retry`, tags, request: { params: BrandItemParams }, responses: { 200: json(C.Job, 'Scheduled to send within a minute'), 404: E, 409: E } }), async (c) => {
    const { brandId, id } = c.req.valid('param');
    return c.json(await jobAction(brandId, (tx, r) => retryJob(tx, brandId, id, r)), 200);
  })
  .openapi(createRoute({ method: 'post', path: `${P}/jobs/{id}/confirm-manual`, tags, request: { params: BrandItemParams, ...body(C.ConfirmManual) }, responses: { 200: json(C.Job), 400: E, 404: E, 409: E } }), async (c) => {
    const { brandId, id } = c.req.valid('param');
    return c.json(await jobAction(brandId, (tx) => confirmManual(tx, brandId, id, c.req.valid('json').url)), 200);
  })
  .openapi(createRoute({ method: 'post', path: `${P}/jobs/{id}/resolve-unknown`, tags, request: { params: BrandItemParams, ...body(C.ResolveUnknown) }, responses: { 200: json(C.Job), 400: E, 404: E, 409: E } }), async (c) => {
    const { brandId, id } = c.req.valid('param');
    return c.json(await jobAction(brandId, (tx) => resolveUnknown(tx, brandId, id, c.req.valid('json'))), 200);
  })
  .openapi(createRoute({ method: 'get', path: `${P}/settings`, tags, request: { params: BrandParams }, responses: { 200: json(C.Settings), 404: E } }), async (c) => {
    const { brandId } = c.req.valid('param');
    return c.json(await withBrand(brandId, (tx) => getSettings(tx, brandId)), 200);
  })
  .openapi(createRoute({ method: 'put', path: `${P}/settings`, tags, request: { params: BrandParams, ...body(C.Settings) }, responses: { 200: json(C.Settings), 400: E, 404: E } }), async (c) => {
    const { brandId } = c.req.valid('param');
    return c.json(await withBrand(brandId, (tx) => setSettings(tx, brandId, c.req.valid('json'))), 200);
  });
