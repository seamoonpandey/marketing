import { OpenAPIHono } from '@hono/zod-openapi';
import { routes as brandRoutes } from './domain/brands/index.ts';
import { errorBody, HttpError } from './http/errors.ts';
import { logger } from './log.ts';
import { moduleRoutes } from './modules.ts';

export const OPENAPI_INFO = { openapi: '3.1.0', info: { title: 'Prachaar API', version: '0.1.0' } };

export function createApp() {
  const app = new OpenAPIHono();

  app.get('/api/health', (c) => c.json({ status: 'ok' }));
  app.route('/api', brandRoutes);
  for (const routes of moduleRoutes) app.route('/api', routes);

  app.notFound((c) => c.json(errorBody('not_found', 'No such route'), 404));
  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json(errorBody(err.code, err.message), err.status as 400);
    // A unique constraint the domain did not check first.
    if ((err.cause as { code?: string } | undefined)?.code === '23505')
      return c.json(errorBody('conflict', 'That already exists'), 409);
    logger.error({ err, path: c.req.path }, 'unhandled error');
    return c.json(errorBody('internal', 'Something went wrong'), 500);
  });

  return app;
}
