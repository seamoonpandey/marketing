import { createRoute, z } from '@hono/zod-openapi';
import * as C from '../../../contracts/research.ts';
import { withBrand } from '../../../db/tenant.ts';
import { BrandItemParams, BrandParams } from '../../../http/brand.ts';
import { createRouter, errorResponse, json } from '../../../http/router.ts';
import { dismissCandidate, listCandidates, restoreCandidate, watchCandidates, type Candidate } from './candidates.ts';
import { suggestKeywords } from './keywords.ts';
import {
  cancelDiscovery, confirmDiscovery, createDiscovery, getDiscovery, listDiscoveries, retryDiscovery, type DiscoveryRun,
} from './run.ts';

const tags = ['research'];
const P = '/brands/{brandId}/research';
const body = <T extends z.ZodType>(schema: T) => ({ body: { required: true, content: { 'application/json': { schema } } } });
const E = errorResponse;

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const toRun = (r: DiscoveryRun): z.infer<typeof C.DiscoveryRun> => ({
  id: r.id, keywords: r.keywords, state: r.state, error: r.error, startedAt: iso(r.startedAt), finishedAt: iso(r.finishedAt),
  estimate: r.estimate, actual: r.actual, counts: r.counts, ownRow: r.ownRow, createdAt: r.createdAt.toISOString(),
});
const toCandidate = (c: Candidate): z.infer<typeof C.DiscoveryCandidate> => ({
  id: c.id, name: c.name, site: c.site, channels: c.channels, place: c.place, cells: c.cells, sourceIds: c.sourceIds, rank: c.rank,
  status: c.status, competitorId: c.competitorId, lastFoundAt: c.lastFoundAt.toISOString(), dismissedAt: iso(c.dismissedAt),
});

export const discoveryRoutes = createRouter()
  .openapi(
    createRoute({
      method: 'post', path: `${P}/discovery/keywords`, tags, request: { params: BrandParams },
      responses: { 200: json(C.KeywordSuggestions, 'Suggested from the approved facts'), 400: E, 402: E, 404: E },
    }),
    async (c) => {
      const { brandId } = c.req.valid('param');
      return c.json({ keywords: await suggestKeywords(brandId) }, 200);
    },
  )
  .openapi(
    createRoute({
      method: 'get', path: `${P}/discoveries`, tags, request: { params: BrandParams },
      responses: { 200: json(z.array(C.DiscoveryRun), 'Newest first'), 404: E },
    }),
    async (c) => {
      const { brandId } = c.req.valid('param');
      return c.json((await withBrand(brandId, (tx) => listDiscoveries(tx, brandId))).map(toRun), 200);
    },
  )
  .openapi(
    createRoute({
      method: 'post', path: `${P}/discoveries`, tags, request: { params: BrandParams, ...body(C.DiscoveryRunCreate) },
      responses: { 201: json(C.DiscoveryRun, 'Waiting for the owner to confirm its estimate'), 400: E, 404: E, 409: E, 503: E },
    }),
    async (c) => {
      const { brandId } = c.req.valid('param');
      const { runId } = await createDiscovery(brandId, c.req.valid('json').keywords);
      return c.json(toRun(await withBrand(brandId, (tx) => getDiscovery(tx, brandId, runId))), 201);
    },
  )
  .openapi(
    createRoute({
      method: 'get', path: `${P}/discoveries/{id}`, tags, request: { params: BrandItemParams },
      responses: { 200: json(C.DiscoveryRun), 404: E },
    }),
    async (c) => {
      const { brandId, id } = c.req.valid('param');
      return c.json(toRun(await withBrand(brandId, (tx) => getDiscovery(tx, brandId, id))), 200);
    },
  )
  .openapi(
    createRoute({
      method: 'post', path: `${P}/discoveries/{id}/confirm`, tags, request: { params: BrandItemParams },
      responses: { 200: json(C.DiscoveryRun), 402: E, 404: E, 409: E },
    }),
    async (c) => {
      const { brandId, id } = c.req.valid('param');
      await confirmDiscovery(brandId, id);
      return c.json(toRun(await withBrand(brandId, (tx) => getDiscovery(tx, brandId, id))), 200);
    },
  )
  .openapi(
    createRoute({
      method: 'post', path: `${P}/discoveries/{id}/cancel`, tags, request: { params: BrandItemParams },
      responses: { 200: json(C.DiscoveryRun), 404: E, 409: E },
    }),
    async (c) => {
      const { brandId, id } = c.req.valid('param');
      await cancelDiscovery(brandId, id);
      return c.json(toRun(await withBrand(brandId, (tx) => getDiscovery(tx, brandId, id))), 200);
    },
  )
  .openapi(
    createRoute({
      method: 'post', path: `${P}/discoveries/{id}/retry`, tags, request: { params: BrandItemParams },
      responses: { 200: json(C.DiscoveryRun), 404: E, 409: E },
    }),
    async (c) => {
      const { brandId, id } = c.req.valid('param');
      await retryDiscovery(brandId, id);
      return c.json(toRun(await withBrand(brandId, (tx) => getDiscovery(tx, brandId, id))), 200);
    },
  )
  .openapi(
    createRoute({
      method: 'get', path: `${P}/candidates`, tags, request: { params: BrandParams, query: C.CandidatesQuery },
      responses: { 200: json(z.array(C.DiscoveryCandidate), 'By overlap (high first), then rank'), 404: E },
    }),
    async (c) => {
      const { brandId } = c.req.valid('param');
      return c.json((await withBrand(brandId, (tx) => listCandidates(tx, brandId, c.req.valid('query').status))).map(toCandidate), 200);
    },
  )
  .openapi(
    createRoute({
      method: 'post', path: `${P}/candidates/watch`, tags, request: { params: BrandParams, ...body(C.CandidateWatch) },
      responses: { 200: json(C.CandidateWatchResult), 400: E, 404: E, 409: E },
    }),
    async (c) => {
      const { brandId } = c.req.valid('param');
      const { watched, unreadable } = await watchCandidates(brandId, c.req.valid('json').ids);
      return c.json({ watched: watched.map(toCandidate), unreadable }, 200);
    },
  )
  .openapi(
    createRoute({
      method: 'post', path: `${P}/candidates/{id}/dismiss`, tags, request: { params: BrandItemParams },
      responses: { 200: json(C.DiscoveryCandidate), 404: E, 409: E },
    }),
    async (c) => {
      const { brandId, id } = c.req.valid('param');
      return c.json(toCandidate(await withBrand(brandId, (tx) => dismissCandidate(tx, brandId, id))), 200);
    },
  )
  .openapi(
    createRoute({
      method: 'post', path: `${P}/candidates/{id}/restore`, tags, request: { params: BrandItemParams },
      responses: { 200: json(C.DiscoveryCandidate), 404: E, 409: E },
    }),
    async (c) => {
      const { brandId, id } = c.req.valid('param');
      return c.json(toCandidate(await withBrand(brandId, (tx) => restoreCandidate(tx, brandId, id))), 200);
    },
  );
