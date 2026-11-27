import { z } from '@hono/zod-openapi';

const decimal = z.string().regex(/^-?\d+(\.\d+)?$/);

export const Money = z
  .object({ usd: decimal.openapi({ example: '6.0000' }), npr: decimal.openapi({ example: '930.48' }) })
  .openapi('Money', { description: 'Decimal strings, never floats.' });
export type Money = z.infer<typeof Money>;

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
