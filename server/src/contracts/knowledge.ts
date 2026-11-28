// Request and response schemas of /api/brands/{brandId}/knowledge.
import { z } from '@hono/zod-openapi';
import { Competitor } from './brands.ts';
import { Money, orNull } from './common.ts';

const id = z.string();
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/).openapi({ example: '#0f5257' });
const isoTime = z.iso.datetime({ offset: true }).openapi({ example: '2026-12-31T18:15:00Z' });

// ── Catalogue ──────────────────────────────────────────────────────────────

export const SectionKey = z
  .enum(['identity', 'business_model', 'products', 'audience', 'positioning', 'voice', 'visual', 'legal', 'goals'])
  .openapi('SectionKey');
export const SubjectType = z.enum(['brand', 'product', 'segment']).openapi('SubjectType');

export const FieldDef = z
  .object({
    key: z.string(),
    label: z.string(),
    type: z.enum(['text', 'longtext', 'number', 'money', 'enum', 'list', 'url', 'date']),
    multi: z.boolean().openapi({ description: 'Several facts may hold this field for one subject; they never conflict.' }),
    asksExpiry: z.boolean().optional().openapi({ description: 'Ask the owner for an expiry date (prices, offers).' }),
    options: z.array(z.string()).optional().openapi({ description: 'The allowed values of an enum field.' }),
    example: z.string().optional().openapi({ description: 'What a typical value looks like, shown to the owner as a hint.' }),
  })
  .openapi('FieldDef');

export const SectionDef = z
  .object({ key: SectionKey, label: z.string(), subject: SubjectType, fields: z.array(FieldDef) })
  .openapi('SectionDef');

// ── Facts ──────────────────────────────────────────────────────────────────

export const FactStatus = z
  .enum(['approved', 'unverified', 'inferred', 'conflicting', 'expired', 'rejected'])
  .openapi('FactStatus', { description: '`expired` is computed: approved, with expiresAt in the past.' });

export const FactValue = z
  .union([z.string().min(1).max(10_000), z.number(), z.array(z.string().min(1).max(2000)).max(100)])
  .openapi('FactValue', {
    description:
      'text, longtext, url, date (YYYY-MM-DD) and enum fields hold a string; list fields an array of strings; '
      + 'number and money fields a number, or the source\'s own text (such as "रु ४,५००"), which is never parsed.',
  });

export const FactSource = z
  .object({
    id,
    kind: z.enum(['page', 'upload']),
    uri: z.string(),
    meta: z.record(z.string(), z.unknown()).openapi({ description: 'A page has `title`; an upload has `filename` and `pages`.' }),
    downloadUrl: z.string().openapi({ description: 'Short-lived. Anything but a raster image downloads as an attachment.' }),
  })
  .openapi('FactSource');

export const Fact = z
  .object({
    id: id.openapi({ description: 'This version. Approve, edit, reject and resolve each add a version with a new id.' }),
    section: SectionKey,
    subjectType: SubjectType,
    subjectId: z.string().nullable(),
    subjectName: z.string().nullable(),
    field: z.string(),
    fieldLabel: z.string(),
    value: FactValue,
    unit: z.string().nullable().openapi({ description: 'The currency of a money value, the unit of a number.' }),
    language: z.string(),
    status: FactStatus,
    origin: z.enum(['stated', 'inferred', 'owner']).openapi({ description: '`owner`: typed or edited by the owner.' }),
    confidence: z.number().nullable().openapi({ description: "The model's confidence, 0 to 1; null for the owner's input." }),
    source: orNull(FactSource).openapi({
      description: 'Set only when `quote` was found in this source\'s text. Null for inferred facts and owner input.',
    }),
    quote: z.string().nullable().openapi({ description: 'Verbatim from `source`, checked by the server.' }),
    page: z.number().int().nullable().openapi({ description: 'The page of an uploaded PDF the quote is on, as the model gave it.' }),
    warning: z.string().nullable().openapi({ example: 'quote not found in source' }),
    version: z.number().int(),
    supersedesId: z.string().nullable(),
    isCurrent: z.boolean().openapi({ description: 'False for an older version; acting on it answers 409.' }),
    verifiedBy: z.string().nullable(),
    verifiedAt: z.string().nullable(),
    expiresAt: z.string().nullable(),
    importRunId: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('Fact');

export const FactList = z
  .object({ items: z.array(Fact), next: z.string().nullable().openapi({ description: 'Pass as `cursor` for the next page.' }) })
  .openapi('FactList');

export const FactQuery = z.object({
  section: SectionKey.optional(),
  status: FactStatus.optional(),
  subjectId: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional().openapi({ description: 'Default 100.' }),
});

const subjectId = z.string().nullable().optional().openapi({
  description: 'Required for products and audience (a subject of that type); absent for the brand\'s own sections.',
});
const unit = z.string().trim().min(1).max(20).nullable().optional();
const expiresAt = isoTime.nullable().optional();

export const FactCreate = z
  .object({
    section: SectionKey,
    subjectId,
    field: z.string().min(1).max(64),
    value: FactValue,
    unit,
    language: z.string().min(2).max(10),
    expiresAt,
  })
  .openapi('FactCreate', { description: "The owner's own value: stored approved, origin owner." });

export const FactPatch = z
  .object({ value: FactValue, unit, expiresAt })
  .openapi('FactPatch', { description: 'Adds an approved version. Omitted unit or expiresAt keep theirs; null clears them.' });

export const FactReject = z.object({ reason: z.string().trim().max(500).optional() }).openapi('FactReject');

export const ApproveBatch = z
  .object({ ids: z.array(z.string()).min(1).max(500) })
  .openapi('ApproveBatch', {
    description: 'Approves quote-checked (`unverified`) facts only. Any other status, or an older version, refuses the whole batch (409).',
  });

export const ConflictResolve = z
  .union([
    z.object({ keepFactId: z.string() }).openapi('ConflictKeep'),
    z
      .object({ section: SectionKey, subjectId, field: z.string().min(1).max(64), value: FactValue, unit, language: z.string().min(2).max(10), expiresAt })
      .openapi('ConflictTypeValue'),
  ])
  .openapi('ConflictResolve', {
    description: 'Keep one fact, or type the right value. Every other current fact on that subject and field is rejected.',
  });

// ── Subjects ───────────────────────────────────────────────────────────────

export const Subject = z
  .object({ id, type: z.enum(['product', 'segment']), name: z.string(), createdAt: z.string() })
  .openapi('Subject');
export const SubjectCreate = z
  .object({ type: z.enum(['product', 'segment']), name: z.string().trim().min(1).max(200) })
  .openapi('SubjectCreate');
export const SubjectQuery = z.object({ type: z.enum(['product', 'segment']).optional() });

// ── Assets ─────────────────────────────────────────────────────────────────

export const AssetKind = z.enum(['logo', 'font', 'photo', 'other']).openapi('AssetKind');
export const AssetRights = z
  .object({
    owner: z.string().max(200).optional().openapi({ description: 'Creator or owner.' }),
    licence: z.string().max(500).optional().openapi({ description: 'Readiness needs this on every asset.' }),
    territory: z.string().max(200).optional(),
    channels: z.array(z.string().max(60)).max(30).optional(),
    commercialUse: z.boolean().optional(),
    paidUse: z.boolean().optional(),
    term: z.string().max(200).optional(),
    expiresAt: z.string().max(40).optional(),
    attribution: z.string().max(500).optional(),
    modelRelease: z.boolean().optional(),
  })
  .openapi('AssetRights');

export const Asset = z
  .object({
    id,
    sourceId: z.string(),
    kind: AssetKind,
    variant: z.string().nullable().openapi({ example: 'white on transparent' }),
    rights: AssetRights,
    licensed: z.boolean().openapi({ description: 'True when rights.licence is filled in.' }),
    source: FactSource,
    createdAt: z.string(),
  })
  .openapi('Asset');

export const AssetCreate = z
  .object({ sourceId: z.string(), kind: AssetKind, variant: z.string().trim().max(200).nullable().optional(), rights: AssetRights.optional() })
  .openapi('AssetCreate', { description: 'Registers a completed upload as an asset.' });
export const AssetUpdate = z
  .object({ kind: AssetKind.optional(), variant: z.string().trim().max(200).nullable().optional(), rights: AssetRights.optional() })
  .openapi('AssetUpdate', { description: '`rights` replaces the stored rights.' });

// ── Palette ────────────────────────────────────────────────────────────────

export const PaletteRole = z.enum(['primary', 'secondary', 'accent', 'text', 'background']).openapi('PaletteRole');

export const PaletteColour = z
  .object({
    id,
    hex: z.string().openapi({ example: '#0f5257' }),
    role: orNull(PaletteRole),
    suggestedRole: orNull(PaletteRole).openapi({ description: 'A guess for a colour without a role, filling only roles no colour holds yet. It is not the role until the owner saves it.' }),
    origin: z.enum(['logo', 'site', 'guide', 'owner']),
    share: z.number().nullable().openapi({ description: 'Share of the logo\'s opaque pixels, 0 to 1; null for site and owner colours.' }),
    rgb: z.object({ r: z.number().int(), g: z.number().int(), b: z.number().int() }),
    cmyk: z
      .object({ c: z.number().int(), m: z.number().int(), y: z.number().int(), k: z.number().int() })
      .openapi({ description: 'Percentages from a naive conversion: approximate, label it so.' }),
  })
  .openapi('PaletteColour');

export const Contrast = z
  .object({
    text: z.string(),
    background: z.string(),
    ratio: z.number().openapi({ description: 'WCAG 2 contrast ratio, 2 decimals.' }),
    aa: z.boolean().openapi({ description: 'At least 4.5: body text passes AA.' }),
    aaLarge: z.boolean().openapi({ description: 'At least 3: large text passes AA.' }),
  })
  .openapi('Contrast');

export const Palette = z
  .object({
    colours: z.array(PaletteColour),
    contrasts: z.array(Contrast).openapi({ description: 'Every colour with role text against every colour with role background.' }),
  })
  .openapi('Palette');

export const PaletteUpdate = z
  .object({
    colours: z.array(z.object({ hex, role: orNull(PaletteRole) })).max(32),
  })
  .openapi('PaletteUpdate', {
    description: 'The whole palette: listed colours keep their origin and share and take the given role; new ones are the owner\'s; unlisted ones are removed.',
  });

// ── Imports ────────────────────────────────────────────────────────────────

export const ImportStage = z.enum(['fetch', 'estimate', 'extract', 'verify', 'done']).openapi('ImportStage');

export const ImportCounts = z
  .object({
    pages: z.number().int().openapi({ description: 'Website pages read.' }),
    pagesFailed: z.number().int(),
    files: z.number().int().openapi({ description: 'Uploaded files in the run.' }),
    batches: z.number().int().openapi({ description: 'Model calls planned.' }),
    unverified: z.number().int().openapi({ description: 'Facts whose quote was found in the source.' }),
    inferred: z.number().int(),
    conflicts: z.number().int(),
    unchanged: z.number().int(),
    dropped: z.number().int().openapi({ description: 'Answers for fields not in the catalogue, or with an invalid value.' }),
    colours: z.number().int().openapi({ description: 'Palette colours added.' }),
    logos: z.number().int().openapi({ description: 'Logos found on the website and stored as files for the owner to confirm.' }),
  })
  .openapi('ImportCounts');

export const ImportRun = z
  .object({
    id,
    websiteUrl: z.string().nullable(),
    sourceIds: z.array(z.string()).openapi({ description: 'Every source the run reads: the pages fetched, then the uploads.' }),
    stage: ImportStage,
    state: z.enum(['running', 'awaiting_approval', 'completed', 'failed_retryable', 'failed_final', 'cancelled']),
    error: z.string().nullable().openapi({ example: 'could not read the website' }),
    blocked: z.string().nullable().openapi({ description: 'Set while awaiting approval when the estimate exceeds what is left of the monthly cap; confirm then answers 402.' }),
    estimate: orNull(Money).openapi({ description: 'The most the extraction can cost; set when the run reaches awaiting_approval.' }),
    actual: orNull(Money).openapi({ description: 'What the model calls cost, failed calls included.' }),
    remaining: Money.openapi({ description: "What the tenant may still spend this month, for CostConfirm." }),
    counts: ImportCounts,
    startedAt: z.string().nullable(),
    finishedAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('ImportRun');

export const ImportCreate = z
  .object({
    websiteUrl: z.url({ protocol: /^https?$/ }).max(2048).nullable().optional(),
    sourceIds: z.array(z.string()).max(50).optional().openapi({ description: 'Completed uploads to read.' }),
  })
  .openapi('ImportCreate', { description: 'A website, uploads, or both. The run fetches, estimates, then waits for confirm.' });

// ── Readiness and brand book ───────────────────────────────────────────────

const FixLink = z.string().openapi({ description: 'App path that fixes it, e.g. /app/b/{brandId}/brand/review?section=products' });

export const Readiness = z
  .object({
    score: z.number().int().openapi({ description: '0 to 100. Not rescaled: 70 is the most this sprint can reach.' }),
    band: z.enum(['blocked', 'draft_only', 'limited_pilot', 'automation']).openapi({ description: 'Any gate makes it blocked.' }),
    gates: z.array(z.object({ label: z.string(), fixPath: FixLink })).openapi({ description: 'Mandatory blockers; shown above the score.' }),
    dimensions: z.array(
      z.object({
        key: z.string(),
        label: z.string(),
        weight: z.number().int(),
        earned: z.number(),
        note: z.string().optional().openapi({ example: 'Set up with Publish' }),
        criteria: z.array(z.object({ label: z.string(), pass: z.boolean(), fixPath: FixLink })),
      }),
    ),
  })
  .openapi('Readiness');

export const BrandBook = z
  .object({
    sections: z.array(z.object({ key: SectionKey, label: z.string(), facts: z.array(Fact) })).openapi({
      description: 'Every catalogue section, in catalogue order, with its current approved, unexpired facts.',
    }),
    palette: Palette,
    assets: z.array(Asset),
    competitors: z.array(Competitor),
    readiness: Readiness,
  })
  .openapi('BrandBook');

export type FactOut = z.infer<typeof Fact>;
export type FactSourceOut = z.infer<typeof FactSource>;
export type ImportRunOut = z.infer<typeof ImportRun>;
export type AssetOut = z.infer<typeof Asset>;
export type PaletteOut = z.infer<typeof Palette>;
export type ReadinessOut = z.infer<typeof Readiness>;
export type BrandBookOut = z.infer<typeof BrandBook>;
