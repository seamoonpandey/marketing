import { z } from '@hono/zod-openapi';

const decimal = z.string().regex(/^-?\d+(\.\d+)?$/);

export const Money = z
  .object({ usd: decimal.openapi({ example: '6.0000' }), npr: decimal.openapi({ example: '930.48' }) })
  .openapi('Money', { description: 'Decimal strings, never floats.' });
export type Money = z.infer<typeof Money>;

/**
 * Money under a module's own component name, without the description Money carries: openapi-typescript turns a
 * referenced schema with a description into `Money & unknown`.
 */
export const namedMoney = (name: string) =>
  z.object({ usd: z.string(), npr: z.string() }).openapi(name, { description: 'Decimal strings: usd to 4 places, npr to 2.' });

/** The schema or null. A referenced schema made nullable with .nullable() comes out of openapi-typescript as `T & (Record<string, never> | null)`. */
export const orNull = <T extends z.ZodType>(s: T) => z.union([s, z.null()]);

export const ApprovedFact = z
  .object({
    id: z.string(),
    section: z.string(),
    subjectType: z.string(),
    subjectId: z.string().nullable(),
    subjectName: z.string().nullable(),
    field: z.string(),
    value: z.unknown(),
    unit: z.string().nullable(),
    language: z.string(),
    sourceId: z.string().nullable(),
    verifiedAt: z.string(),
    expiresAt: z.string().nullable(),
  })
  .openapi('ApprovedFact');
export type ApprovedFact = z.infer<typeof ApprovedFact>;

export const ErrorBody = z
  .object({ error: z.object({ code: z.string(), message: z.string() }) })
  .openapi('Error');
