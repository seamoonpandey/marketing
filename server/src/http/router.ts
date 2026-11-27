import { OpenAPIHono, z } from '@hono/zod-openapi';
import { ErrorBody } from '../contracts/common.ts';
import { errorBody } from './errors.ts';

/** An OpenAPIHono router whose request validation failures answer with the base error body (400). */
export function createRouter() {
  return new OpenAPIHono({
    defaultHook: (result, c) => {
      if (!result.success) return c.json(errorBody('validation', z.prettifyError(result.error)), 400);
    },
  });
}

/** OpenAPI response entries for a JSON body and for the error statuses a route can return. */
export const json = <T extends z.ZodType>(schema: T, description = 'OK') => ({
  description,
  content: { 'application/json': { schema } },
});

export const errorResponse = json(ErrorBody, 'Error: `{ error: { code, message } }`');
