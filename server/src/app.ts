import { OpenAPIHono } from '@hono/zod-openapi';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
import { isUniqueViolation } from './db/client.ts';
import { routes as brandRoutes } from './domain/brands/index.ts';
import { errorBody, HttpError } from './http/errors.ts';
import { logger } from './log.ts';
import { moduleRoutes } from './modules.ts';

export const OPENAPI_INFO = { openapi: '3.1.0', info: { title: 'Prachaar API', version: '0.1.0' } };

/** No JSON body the API takes comes near this; files go straight to storage on presigned URLs. */
export const MAX_BODY_BYTES = 1024 * 1024;

export function createApp() {
  const app = new OpenAPIHono();

  app.use('*', secureHeaders());
  app.use('/api/*', bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json(errorBody('too_large', 'The request body is larger than 1 MB'), 413) }));
  app.get('/api/health', (c) => c.json({ status: 'ok' }));
  app.route('/api', brandRoutes);
  for (const routes of moduleRoutes) app.route('/api', routes);

  app.notFound((c) => c.json(errorBody('not_found', 'No such route'), 404));
  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json(errorBody(err.code, err.message), err.status as 400);
    // Hono's own request errors: a body that is not JSON, or no JSON Content-Type.
    if (err instanceof HTTPException) return c.json(errorBody('validation', err.message), err.status);
    // A unique constraint the domain did not check first.
    if (isUniqueViolation(err))
      return c.json(errorBody('conflict', 'That already exists'), 409);
    logger.error({ err, path: c.req.path }, 'unhandled error');
    return c.json(errorBody('internal', 'Something went wrong'), 500);
  });

  return app;
}
