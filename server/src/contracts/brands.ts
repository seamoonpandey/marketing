import { z } from '@hono/zod-openapi';
import { Money } from './common.ts';

const url = z.url({ protocol: /^https?$/ }).max(2048);

export const Brand = z
  .object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    website: z.string().nullable(),
    country: z.string(),
    timezone: z.string(),
    currency: z.string(),
    defaultLanguage: z.string(),
    languages: z.array(z.string()),
    status: z.enum(['active', 'archived']),
    createdAt: z.string(),
  })
  .openapi('Brand');

export const BrandCreate = z
  .object({
    name: z.string().trim().min(1).max(200),
    website: url.nullable().optional(),
    country: z.string().length(2).optional(),
    timezone: z.string().min(1).max(64).optional(),
    currency: z.string().length(3).optional(),
    defaultLanguage: z.string().min(2).max(10).optional(),
    languages: z.array(z.string().min(2).max(10)).min(1).max(10).optional(),
  })
  .openapi('BrandCreate');

const notEmpty = [(o: object) => Object.keys(o).length > 0, 'Send at least one field to change'] as const;

export const BrandUpdate = BrandCreate.partial().refine(...notEmpty).openapi('BrandUpdate');

export const CompetitorKind = z.enum(['direct', 'indirect', 'aspirational']);

export const Competitor = z
  .object({
    id: z.string(),
    name: z.string(),
    kind: CompetitorKind,
    site: z.string().nullable(),
    handles: z.record(z.string(), z.string()),
    adLibraryUrl: z.string().nullable(),
    priority: z.number().int(),
  })
  .openapi('Competitor');

export const CompetitorCreate = z
  .object({
    name: z.string().trim().min(1).max(200),
    kind: CompetitorKind.optional(),
    site: url.nullable().optional(),
    handles: z.record(z.string().max(40), z.string().max(200)).optional(),
    adLibraryUrl: url.nullable().optional(),
    priority: z.number().int().min(0).max(100).optional(),
  })
  .openapi('CompetitorCreate');

export const CompetitorUpdate = CompetitorCreate.partial().refine(...notEmpty).openapi('CompetitorUpdate');

export const SourceOut = z
  .object({
    id: z.string(),
    brandId: z.string(),
    kind: z.enum(['page', 'upload']),
    uri: z.string(),
    mime: z.string(),
    checksum: z.string(),
    capturedAt: z.string(),
    trust: z.enum(['owner', 'brand_site', 'external']),
    meta: z.record(z.string(), z.unknown()),
    hasText: z.boolean(),
    downloadUrl: z.string().openapi({ description: 'Short-lived. Anything but a raster image downloads as an attachment.' }),
  })
  .openapi('Source');

export const UploadCreate = z
  .object({
    filename: z.string().min(1).max(1024),
    mime: z.string().openapi({ example: 'application/pdf' }),
    bytes: z.number().int().positive(),
  })
  .openapi('UploadCreate');

export const UploadCreated = z
  .object({
    source: SourceOut,
    uploadUrl: z.string().openapi({ description: 'PUT the file here with the same Content-Type, then call complete.' }),
  })
  .openapi('UploadCreated');

export const CostRun = z
  .object({
    runType: z.string(),
    runId: z.string(),
    calls: z.number().int(),
    failedCalls: z.number().int(),
    inputTokens: z.number().int(),
    outputTokens: z.number().int(),
    cost: Money,
    lastAt: z.string(),
  })
  .openapi('CostRun');

export const Costs = z
  .object({
    month: z.string().openapi({ example: '2026-11' }),
    total: Money.openapi({ description: "This brand's AI spend this month (UTC)." }),
    cap: Money,
    remaining: Money.openapi({ description: "What the tenant may still spend this month, across all its brands." }),
    runs: z.array(CostRun),
  })
  .openapi('Costs');

export const AuditEvent = z
  .object({
    id: z.string(),
    actor: z.string(),
    action: z.string(),
    objectType: z.string(),
    objectId: z.string(),
    objectVersion: z.number().int().nullable(),
    result: z.enum(['ok', 'denied', 'failed']),
    reason: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('AuditEvent');

export type BrandCreate = z.infer<typeof BrandCreate>;
export type BrandUpdate = z.infer<typeof BrandUpdate>;
export type CompetitorCreate = z.infer<typeof CompetitorCreate>;
export type CompetitorUpdate = z.infer<typeof CompetitorUpdate>;
