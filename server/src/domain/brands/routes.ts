import { createRoute, z } from '@hono/zod-openapi';
import {
  AuditEvent, Brand, BrandCreate, BrandUpdate, Competitor, CompetitorCreate, CompetitorUpdate, Costs, SourceOut,
  UploadCreate, UploadCreated,
} from '../../contracts/brands.ts';
import { withBrand, withTenant } from '../../db/tenant.ts';
import { BrandItemParams, BrandParams } from '../../http/brand.ts';
import { createRouter, errorResponse, json } from '../../http/router.ts';
import { presignDownload } from '../../storage/index.ts';
import { listAudit } from '../audit/index.ts';
import { brandCosts } from '../costs/index.ts';
import { completeUpload, createUpload, getSource, listSources, type Source } from '../sources/index.ts';
import {
  archiveBrand, createBrand, createCompetitor, deleteCompetitor, getBrand, listBrands, listCompetitors,
  updateBrand, updateCompetitor, type Brand as BrandRow,
} from './index.ts';

const toBrand = (b: BrandRow): z.infer<typeof Brand> => ({
  id: b.id, name: b.name, slug: b.slug, website: b.website, country: b.country, timezone: b.timezone,
  currency: b.currency, defaultLanguage: b.defaultLanguage, languages: b.languages, status: b.status,
  createdAt: b.createdAt.toISOString(),
});

const toSource = async (s: Source): Promise<z.infer<typeof SourceOut>> => ({
  id: s.id, brandId: s.brandId, kind: s.kind, uri: s.uri, mime: s.mime, checksum: s.checksum,
  capturedAt: s.capturedAt.toISOString(), trust: s.trust, meta: s.meta, hasText: s.text !== null,
  downloadUrl: await presignDownload(s.objectKey),
});

const body = <T extends z.ZodType>(schema: T) => ({
  body: { required: true, content: { 'application/json': { schema } } },
});

const tags = ['brands'];

export const routes = createRouter()
  .openapi(
    createRoute({ method: 'get', path: '/brands', tags, responses: { 200: json(z.array(Brand)) } }),
    async (c) => c.json((await withTenant(listBrands)).map(toBrand), 200),
  )
  .openapi(
    createRoute({
      method: 'post', path: '/brands', tags, request: body(BrandCreate),
      responses: { 201: json(Brand, 'Created'), 400: errorResponse, 409: errorResponse },
    }),
    async (c) => c.json(toBrand(await withTenant((tx) => createBrand(tx, c.req.valid('json')))), 201),
  )
  .openapi(
    createRoute({
      method: 'get', path: '/brands/{brandId}', tags, request: { params: BrandParams },
      responses: { 200: json(Brand), 404: errorResponse },
    }),
    async (c) => {
      const { brandId } = c.req.valid('param');
      return c.json(toBrand(await withBrand(brandId, (tx) => getBrand(tx, brandId))), 200);
    },
  )
  .openapi(
    createRoute({
      method: 'patch', path: '/brands/{brandId}', tags, request: { params: BrandParams, ...body(BrandUpdate) },
      responses: { 200: json(Brand), 400: errorResponse, 404: errorResponse },
    }),
    async (c) => {
      const { brandId } = c.req.valid('param');
      return c.json(toBrand(await withBrand(brandId, (tx) => updateBrand(tx, brandId, c.req.valid('json')))), 200);
    },
  )
  .openapi(
    createRoute({
      method: 'post', path: '/brands/{brandId}/archive', tags, request: { params: BrandParams },
      responses: { 200: json(Brand), 404: errorResponse },
    }),
    async (c) => {
      const { brandId } = c.req.valid('param');
      return c.json(toBrand(await withBrand(brandId, (tx) => archiveBrand(tx, brandId))), 200);
    },
  )
  .openapi(
    createRoute({
      method: 'get', path: '/brands/{brandId}/competitors', tags: ['competitors'], request: { params: BrandParams },
      responses: { 200: json(z.array(Competitor)), 404: errorResponse },
    }),
    async (c) => {
      const { brandId } = c.req.valid('param');
      return c.json(await withBrand(brandId, (tx) => listCompetitors(tx, brandId)), 200);
    },
  )
  .openapi(
    createRoute({
      method: 'post', path: '/brands/{brandId}/competitors', tags: ['competitors'],
      request: { params: BrandParams, ...body(CompetitorCreate) },
      responses: { 201: json(Competitor, 'Created'), 400: errorResponse, 404: errorResponse },
    }),
    async (c) => {
      const { brandId } = c.req.valid('param');
      return c.json(await withBrand(brandId, (tx) => createCompetitor(tx, brandId, c.req.valid('json'))), 201);
    },
  )
  .openapi(
    createRoute({
      method: 'patch', path: '/brands/{brandId}/competitors/{id}', tags: ['competitors'],
      request: { params: BrandItemParams, ...body(CompetitorUpdate) },
      responses: { 200: json(Competitor), 400: errorResponse, 404: errorResponse },
    }),
    async (c) => {
      const { brandId, id } = c.req.valid('param');
      return c.json(await withBrand(brandId, (tx) => updateCompetitor(tx, brandId, id, c.req.valid('json'))), 200);
    },
  )
  .openapi(
    createRoute({
      method: 'delete', path: '/brands/{brandId}/competitors/{id}', tags: ['competitors'],
      request: { params: BrandItemParams },
      responses: { 204: { description: 'Deleted' }, 404: errorResponse },
    }),
    async (c) => {
      const { brandId, id } = c.req.valid('param');
      await withBrand(brandId, (tx) => deleteCompetitor(tx, brandId, id));
      return c.body(null, 204);
    },
  )
  .openapi(
    createRoute({
      method: 'get', path: '/brands/{brandId}/sources', tags: ['sources'], request: { params: BrandParams },
      responses: { 200: json(z.array(SourceOut)), 404: errorResponse },
    }),
    async (c) => {
      const { brandId } = c.req.valid('param');
      const list = await withBrand(brandId, (tx) => listSources(tx, brandId));
      return c.json(await Promise.all(list.map(toSource)), 200);
    },
  )
  .openapi(
    createRoute({
      method: 'get', path: '/brands/{brandId}/sources/{id}', tags: ['sources'], request: { params: BrandItemParams },
      responses: { 200: json(SourceOut), 404: errorResponse },
    }),
    async (c) => {
      const { brandId, id } = c.req.valid('param');
      return c.json(await toSource(await withBrand(brandId, (tx) => getSource(tx, brandId, id))), 200);
    },
  )
  .openapi(
    createRoute({
      method: 'post', path: '/brands/{brandId}/sources/uploads', tags: ['sources'],
      request: { params: BrandParams, ...body(UploadCreate) },
      responses: { 201: json(UploadCreated, 'Created'), 400: errorResponse, 404: errorResponse },
    }),
    async (c) => {
      const { brandId } = c.req.valid('param');
      const { source, uploadUrl } = await withBrand(brandId, (tx) => createUpload(tx, brandId, c.req.valid('json')));
      return c.json({ source: await toSource(source), uploadUrl }, 201);
    },
  )
  .openapi(
    createRoute({
      method: 'post', path: '/brands/{brandId}/sources/{id}/complete', tags: ['sources'],
      request: { params: BrandItemParams },
      responses: { 200: json(SourceOut), 400: errorResponse, 404: errorResponse },
    }),
    async (c) => {
      const { brandId, id } = c.req.valid('param');
      return c.json(await toSource(await withBrand(brandId, (tx) => completeUpload(tx, brandId, id))), 200);
    },
  )
  .openapi(
    createRoute({
      method: 'get', path: '/brands/{brandId}/costs', tags: ['costs'], request: { params: BrandParams },
      responses: { 200: json(Costs), 404: errorResponse },
    }),
    async (c) => {
      const { brandId } = c.req.valid('param');
      return c.json(await withBrand(brandId, (tx) => brandCosts(tx, brandId)), 200);
    },
  )
  .openapi(
    createRoute({
      method: 'get', path: '/brands/{brandId}/audit', tags: ['audit'], request: { params: BrandParams },
      responses: { 200: json(z.array(AuditEvent)), 404: errorResponse },
    }),
    async (c) => {
      const { brandId } = c.req.valid('param');
      const events = await withBrand(brandId, (tx) => listAudit(tx, brandId));
      return c.json(events.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })), 200);
    },
  );
