import { createRoute, z } from '@hono/zod-openapi';
import {
  ApproveBatch, Asset, AssetCreate, AssetUpdate, BrandBook, ConflictResolve, Fact, FactCreate, FactList, FactPatch,
  FactQuery, FactReject, ImportCreate, ImportRun, Palette, PaletteUpdate, Readiness, SectionDef, Subject, SubjectCreate,
  SubjectQuery,
} from '../../contracts/knowledge.ts';
import { BrandItemParams, BrandParams } from '../../http/brand.ts';
import { HttpError } from '../../http/errors.ts';
import { createRouter, errorResponse, json } from '../../http/router.ts';

const P = '/brands/{brandId}/knowledge';
const RunParams = BrandParams.extend({ runId: z.string().openapi({ param: { name: 'runId', in: 'path' } }) });

const body = <T extends z.ZodType>(schema: T, required = true) => ({
  body: { required, content: { 'application/json': { schema } } },
});

const notBuilt = (): never => {
  throw new HttpError(501, 'not_implemented', 'This route is declared but not built yet');
};

export const routes = createRouter()
  // Catalogue
  .openapi(
    createRoute({
      method: 'get', path: `${P}/catalogue`, tags: ['knowledge'], request: { params: BrandParams },
      responses: { 200: json(z.array(SectionDef)), 404: errorResponse },
    }),
    async () => notBuilt(),
  )
  // Imports
  .openapi(
    createRoute({
      method: 'get', path: `${P}/imports`, tags: ['imports'], request: { params: BrandParams },
      responses: { 200: json(z.array(ImportRun), 'The 20 newest runs, newest first'), 404: errorResponse },
    }),
    async () => notBuilt(),
  )
  .openapi(
    createRoute({
      method: 'post', path: `${P}/imports`, tags: ['imports'], request: { params: BrandParams, ...body(ImportCreate) },
      responses: { 201: json(ImportRun, 'Created: the run fetches, estimates, then waits at awaiting_approval'), 400: errorResponse, 404: errorResponse },
    }),
    async () => notBuilt(),
  )
  .openapi(
    createRoute({
      method: 'get', path: `${P}/imports/{runId}`, tags: ['imports'], request: { params: RunParams },
      responses: { 200: json(ImportRun), 404: errorResponse },
    }),
    async () => notBuilt(),
  )
  .openapi(
    createRoute({
      method: 'post', path: `${P}/imports/{runId}/confirm`, tags: ['imports'], request: { params: RunParams },
      description: 'Starts the paid extraction. 402 when the estimate exceeds what is left of the monthly cap; 409 unless awaiting approval.',
      responses: { 200: json(ImportRun), 402: errorResponse, 404: errorResponse, 409: errorResponse },
    }),
    async () => notBuilt(),
  )
  .openapi(
    createRoute({
      method: 'post', path: `${P}/imports/{runId}/cancel`, tags: ['imports'], request: { params: RunParams },
      responses: { 200: json(ImportRun), 404: errorResponse, 409: errorResponse },
    }),
    async () => notBuilt(),
  )
  .openapi(
    createRoute({
      method: 'post', path: `${P}/imports/{runId}/retry`, tags: ['imports'], request: { params: RunParams },
      description: 'Resumes a failed_retryable run from the step that failed; finished model calls are not repeated.',
      responses: { 200: json(ImportRun), 404: errorResponse, 409: errorResponse },
    }),
    async () => notBuilt(),
  )
  // Facts
  .openapi(
    createRoute({
      method: 'get', path: `${P}/facts`, tags: ['facts'], request: { params: BrandParams, query: FactQuery },
      description: 'Current versions only, oldest first.',
      responses: { 200: json(FactList), 400: errorResponse, 404: errorResponse },
    }),
    async () => notBuilt(),
  )
  .openapi(
    createRoute({
      method: 'post', path: `${P}/facts`, tags: ['facts'], request: { params: BrandParams, ...body(FactCreate) },
      description: 'For a single-valued field that already has a current fact, this edits it (a new version); 409 while it is conflicting.',
      responses: { 201: json(Fact, 'Created'), 400: errorResponse, 404: errorResponse, 409: errorResponse },
    }),
    async () => notBuilt(),
  )
  .openapi(
    createRoute({
      method: 'post', path: `${P}/facts/approve-batch`, tags: ['facts'], request: { params: BrandParams, ...body(ApproveBatch) },
      responses: { 200: json(z.array(Fact), 'The approved versions, in the order given'), 400: errorResponse, 404: errorResponse, 409: errorResponse },
    }),
    async () => notBuilt(),
  )
  .openapi(
    createRoute({
      method: 'patch', path: `${P}/facts/{id}`, tags: ['facts'], request: { params: BrandItemParams, ...body(FactPatch) },
      responses: { 200: json(Fact, 'The new, approved version'), 400: errorResponse, 404: errorResponse, 409: errorResponse },
    }),
    async () => notBuilt(),
  )
  .openapi(
    createRoute({
      method: 'post', path: `${P}/facts/{id}/approve`, tags: ['facts'], request: { params: BrandItemParams },
      description: '409 for a conflicting fact (resolve it) or an older version.',
      responses: { 200: json(Fact, 'The new, approved version'), 404: errorResponse, 409: errorResponse },
    }),
    async () => notBuilt(),
  )
  .openapi(
    createRoute({
      method: 'post', path: `${P}/facts/{id}/reject`, tags: ['facts'], request: { params: BrandItemParams, ...body(FactReject, false) },
      description: '409 for a conflicting fact (resolve it) or an older version.',
      responses: { 200: json(Fact, 'The new, rejected version'), 400: errorResponse, 404: errorResponse, 409: errorResponse },
    }),
    async () => notBuilt(),
  )
  .openapi(
    createRoute({
      method: 'get', path: `${P}/facts/{id}/history`, tags: ['facts'], request: { params: BrandItemParams },
      responses: { 200: json(z.array(Fact), 'Every version of the fact, oldest first'), 404: errorResponse },
    }),
    async () => notBuilt(),
  )
  .openapi(
    createRoute({
      method: 'post', path: `${P}/conflicts/resolve`, tags: ['facts'], request: { params: BrandParams, ...body(ConflictResolve) },
      responses: { 200: json(Fact, 'The approved fact'), 400: errorResponse, 404: errorResponse, 409: errorResponse },
    }),
    async () => notBuilt(),
  )
  // Subjects
  .openapi(
    createRoute({
      method: 'get', path: `${P}/subjects`, tags: ['subjects'], request: { params: BrandParams, query: SubjectQuery },
      responses: { 200: json(z.array(Subject)), 400: errorResponse, 404: errorResponse },
    }),
    async () => notBuilt(),
  )
  .openapi(
    createRoute({
      method: 'post', path: `${P}/subjects`, tags: ['subjects'], request: { params: BrandParams, ...body(SubjectCreate) },
      responses: { 201: json(Subject, 'Created, or the existing subject of that type and name'), 400: errorResponse, 404: errorResponse },
    }),
    async () => notBuilt(),
  )
  // Assets
  .openapi(
    createRoute({
      method: 'get', path: `${P}/assets`, tags: ['assets'], request: { params: BrandParams },
      responses: { 200: json(z.array(Asset)), 404: errorResponse },
    }),
    async () => notBuilt(),
  )
  .openapi(
    createRoute({
      method: 'post', path: `${P}/assets`, tags: ['assets'], request: { params: BrandParams, ...body(AssetCreate) },
      responses: { 201: json(Asset, 'Created'), 400: errorResponse, 404: errorResponse },
    }),
    async () => notBuilt(),
  )
  .openapi(
    createRoute({
      method: 'patch', path: `${P}/assets/{id}`, tags: ['assets'], request: { params: BrandItemParams, ...body(AssetUpdate) },
      responses: { 200: json(Asset), 400: errorResponse, 404: errorResponse },
    }),
    async () => notBuilt(),
  )
  // Palette
  .openapi(
    createRoute({
      method: 'get', path: `${P}/palette`, tags: ['palette'], request: { params: BrandParams },
      responses: { 200: json(Palette), 404: errorResponse },
    }),
    async () => notBuilt(),
  )
  .openapi(
    createRoute({
      method: 'put', path: `${P}/palette`, tags: ['palette'], request: { params: BrandParams, ...body(PaletteUpdate) },
      responses: { 200: json(Palette), 400: errorResponse, 404: errorResponse },
    }),
    async () => notBuilt(),
  )
  // Readiness and brand book
  .openapi(
    createRoute({
      method: 'get', path: `${P}/readiness`, tags: ['readiness'], request: { params: BrandParams },
      responses: { 200: json(Readiness), 404: errorResponse },
    }),
    async () => notBuilt(),
  )
  .openapi(
    createRoute({
      method: 'get', path: `${P}/book`, tags: ['readiness'], request: { params: BrandParams },
      responses: { 200: json(BrandBook), 404: errorResponse },
    }),
    async () => notBuilt(),
  );
