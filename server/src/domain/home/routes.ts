import { createRoute } from '@hono/zod-openapi';
import * as C from '../../contracts/home.ts';
import { BrandParams } from '../../http/brand.ts';
import { errorResponse as E, createRouter, json } from '../../http/router.ts';
import { home } from './index.ts';

export const routes = createRouter().openapi(
  createRoute({ method: 'get', path: '/brands/{brandId}/home', tags: ['home'], request: { params: BrandParams }, responses: { 200: json(C.Home), 404: E } }),
  async (c) => c.json(await home(c.req.valid('param').brandId), 200),
);
