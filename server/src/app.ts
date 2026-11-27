import { OpenAPIHono } from '@hono/zod-openapi';
import { errorBody, HttpError } from './http/errors.ts';
import { logger } from './log.ts';

export function createApp() {
  const app = new OpenAPIHono();

  app.get('/api/health', (c) => c.json({ status: 'ok' }));

  app.notFound((c) => c.json(errorBody('not_found', 'No such route'), 404));
  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json(errorBody(err.code, err.message), err.status as 400);
    logger.error({ err, path: c.req.path }, 'unhandled error');
    return c.json(errorBody('internal', 'Something went wrong'), 500);
  });

  return app;
}
