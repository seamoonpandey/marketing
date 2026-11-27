import createClient from 'openapi-fetch';
import type { components, paths } from './schema';

/** The typed API client. Paths and bodies come from server/openapi.json (`pnpm api:types`). */
export const api = createClient<paths>({ baseUrl: '' });

export type Schemas = components['schemas'];
export type Money = Schemas['Money'];

/** A non-2xx answer, or no answer at all (status 0). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** The data of an openapi-fetch call, or an ApiError carrying the base error body's code and message. */
export async function unwrap<T>(call: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  let result: Awaited<typeof call>;
  try {
    result = await call;
  } catch {
    throw new ApiError(0, 'unavailable', 'Prachaar’s server did not answer.');
  }
  const { data, error, response } = result;
  if (response.ok) return data as T;
  const body = (error as { error?: { code?: string; message?: string } } | undefined)?.error;
  if (body?.code && body.message) throw new ApiError(response.status, body.code, body.message);
  // No error body: the proxy answered because the API is down or overloaded.
  throw new ApiError(response.status, response.status === 429 ? 'rate_limited' : 'unavailable', 'Prachaar’s server did not answer.');
}
