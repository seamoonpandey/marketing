import { z } from '@hono/zod-openapi';

/**
 * Path params of every route under /api/brands/{brandId}. brandId stays a plain string: the handler
 * passes it to withBrand, which answers 404 and audits a `denied` event for anything not in the tenant.
 */
export const BrandParams = z.object({
  brandId: z.string().openapi({ param: { name: 'brandId', in: 'path' }, example: '0196f3c2-0000-7000-8000-000000000000' }),
});

export const BrandItemParams = BrandParams.extend({
  id: z.string().openapi({ param: { name: 'id', in: 'path' } }),
});
