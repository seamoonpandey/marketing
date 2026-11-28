import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AiError, estimateTokens, extract } from '../../../ai/index.ts';
import { config } from '../../../config.ts';
import type { Money } from '../../../contracts/common.ts';
import type { ImportRunOut } from '../../../contracts/knowledge.ts';
import { importRuns, type ImportCounts } from '../../../db/schema/knowledge.ts';
import { isUuid, withBrand, type Tx } from '../../../db/tenant.ts';
import { BudgetError, ConflictError, HttpError, NotFoundError, ValidationError } from '../../../http/errors.ts';
import { logger } from '../../../log.ts';
import { getObject } from '../../../storage/index.ts';
import { audit } from '../../audit/index.ts';
import { estimateCost, remainingMonthlyCap } from '../../costs/index.ts';
import { fetchText, getSource, pickPages, savePageSource, saveSiteImage } from '../../sources/index.ts';
import { logoKeys } from '../assets.ts';
import { proposeFacts, type ProposedFact } from '../facts/index.ts';
import { addColours, cssColours, extractPalette } from '../palette/index.ts';
import { EXTRACTION_SYSTEM, Extraction, isFile, sourceParts, toProposed } from './prompt.ts';
import { fontFamilies, logoCandidates, stylesheetLinks } from './site.ts';

export { EXTRACTION_SYSTEM } from './prompt.ts';

/** cost_events.run_type of every import call; screens total brand costs by the `brand_` prefix. */
export const RUN_TYPE = 'brand_import';
export const MAX_OUTPUT_TOKENS = 16_000;
/** At most this many estimated source tokens go into one model call. Tests lower it to get several batches. */
export const batching = { maxTokens: 150_000 };

/** A failure whose message is for the owner as is. */
class ImportFailure extends Error {}
/** The run is no longer running (cancelled): the step stops and changes nothing. */
class RunStopped extends Error {}

type RunRow = typeof importRuns.$inferSelect;
type Counts = Required<ImportCounts>;
type ProposeCounts = Pick<Counts, 'unverified' | 'inferred' | 'conflicts' | 'unchanged' | 'dropped'>;

const ZERO: Counts = {
  pages: 0, pagesFailed: 0, files: 0, batches: 0, unverified: 0, inferred: 0, conflicts: 0, unchanged: 0, dropped: 0, colours: 0, logos: 0,
};
const OPERATOR = 'operator';
const iso = (d: Date | null) => (d ? d.toISOString() : null);

// ── Reading ────────────────────────────────────────────────────────────────

async function runRow(tx: Tx, brandId: string, runId: string, lock = false): Promise<RunRow> {
  const q = tx.select().from(importRuns).where(and(eq(importRuns.id, runId), eq(importRuns.brandId, brandId)));
  const [row] = isUuid(runId) ? await (lock ? q.for('share') : q) : [];
  if (!row) throw new NotFoundError('import', runId);
  return row;
}

async function toOut(tx: Tx, r: RunRow): Promise<ImportRunOut> {
  return {
    id: r.id, websiteUrl: r.websiteUrl, sourceIds: r.sourceIds, stage: r.stage, state: r.state, error: r.error,
    blocked: r.blocked, estimate: r.estimate ?? null, actual: r.actual ?? null, remaining: await remainingMonthlyCap(tx),
    counts: { ...ZERO, ...r.counts }, startedAt: iso(r.startedAt), finishedAt: iso(r.finishedAt), createdAt: r.createdAt.toISOString(),
  };
}

export async function getImport(tx: Tx, brandId: string, runId: string): Promise<ImportRunOut> {
  return toOut(tx, await runRow(tx, brandId, runId));
}

/** The 20 newest runs, newest first. */
export async function listImports(tx: Tx, brandId: string): Promise<ImportRunOut[]> {
  const rows = await tx.select().from(importRuns).where(eq(importRuns.brandId, brandId)).orderBy(desc(importRuns.createdAt)).limit(20);
  const out = [];
  for (const r of rows) out.push(await toOut(tx, r));
  return out;
}

/** What this run's model calls cost so far, failed calls included. */
async function actualCost(tx: Tx, runId: string): Promise<Money> {
  const { rows } = await tx.execute<Money>(sql`
    select round(coalesce(sum(cost_usd), 0), 4)::text as usd, coalesce(sum(cost_npr), 0)::numeric(14, 2)::text as npr
    from cost_events where run_type = ${RUN_TYPE} and run_id = ${runId}`);
  return rows[0]!;
}

// ── Owner actions (the workflow file adds the DBOS calls) ─────────────────

/** Validates and stores a new run in state running. Uploads only: pages come from the website. */
export async function createRun(
  tx: Tx, brandId: string, i: { websiteUrl?: string | null; sourceIds?: string[] },
): Promise<{ runId: string; workflowId: string }> {
  const ids = [...new Set(i.sourceIds ?? [])];
  if (!i.websiteUrl && !ids.length) throw new ValidationError('Give a website, files, or both');
  for (const id of ids) {
    const s = await getSource(tx, brandId, id);
    if (s.kind !== 'upload' || s.meta.status !== 'ready')
      throw new ValidationError(`${String(s.meta.filename ?? s.uri)} is not a completed upload`);
  }
  const [row] = await tx
    .insert(importRuns)
    .values({ brandId, websiteUrl: i.websiteUrl ?? null, sourceIds: ids, stage: 'fetch', state: 'running', startedAt: new Date() })
    .returning({ id: importRuns.id });
  const workflowId = `brand-import:${row!.id}:fetch`;
  await tx.update(importRuns).set({ workflowId }).where(eq(importRuns.id, row!.id));
  await audit(tx, { brandId, actor: OPERATOR, action: 'import.start', objectType: 'import', objectId: row!.id, result: 'ok' });
  return { runId: row!.id, workflowId };
}

/** awaiting_approval → running, if the estimate still fits what is left of the monthly cap. */
export async function confirmRun(tx: Tx, brandId: string, runId: string, workflowId: string): Promise<void> {
  const run = await runRow(tx, brandId, runId);
  if (run.state !== 'awaiting_approval') throw new ConflictError(`The import is ${run.state}, not awaiting approval`);
  const remaining = await remainingMonthlyCap(tx);
  if (Number(run.estimate?.npr ?? 0) > Number(remaining.npr))
    throw new BudgetError(`This import may cost NPR ${run.estimate!.npr}; NPR ${remaining.npr} of this month's AI budget is left`);
  const done = await tx
    .update(importRuns)
    .set({ state: 'running', stage: 'extract', blocked: null, workflowId })
    .where(and(eq(importRuns.id, runId), eq(importRuns.state, 'awaiting_approval')))
    .returning({ id: importRuns.id });
  if (!done.length) throw new ConflictError('The import was confirmed or cancelled meanwhile');
  await audit(tx, { brandId, actor: OPERATOR, action: 'import.confirm', objectType: 'import', objectId: runId, result: 'ok' });
}

const SETTLED = ['completed', 'cancelled', 'failed_final'] as const;

/** Any unsettled state → cancelled. Steps check the state before running, so no later step does anything. */
export async function cancelRun(tx: Tx, brandId: string, runId: string): Promise<RunRow> {
  const run = await runRow(tx, brandId, runId);
  if ((SETTLED as readonly string[]).includes(run.state)) throw new ConflictError(`The import is already ${run.state}`);
  const [row] = await tx
    .update(importRuns)
    .set({ state: 'cancelled', blocked: null, finishedAt: new Date(), actual: await actualCost(tx, runId) })
    .where(and(eq(importRuns.id, runId), eq(importRuns.state, run.state)))
    .returning();
  if (!row) throw new ConflictError('The import changed meanwhile; reload it');
  await audit(tx, { brandId, actor: OPERATOR, action: 'import.cancel', objectType: 'import', objectId: runId, result: 'ok' });
  return row;
}

/** failed_retryable → running, before the workflow is forked from its failed step. */
export async function reopenRun(tx: Tx, brandId: string, runId: string): Promise<RunRow> {
  const run = await runRow(tx, brandId, runId);
  if (run.state !== 'failed_retryable') throw new ConflictError(`The import is ${run.state}; only a failed_retryable import can be retried`);
  const [row] = await tx
    .update(importRuns)
    .set({ state: 'running', error: null, finishedAt: null })
    .where(and(eq(importRuns.id, runId), eq(importRuns.state, 'failed_retryable')))
    .returning();
  if (!row) throw new ConflictError('The import changed meanwhile; reload it');
  await audit(tx, { brandId, actor: OPERATOR, action: 'import.retry', objectType: 'import', objectId: runId, result: 'ok' });
  return row;
}

export async function setWorkflow(tx: Tx, brandId: string, runId: string, workflowId: string): Promise<void> {
  await tx.update(importRuns).set({ workflowId }).where(and(eq(importRuns.id, runId), eq(importRuns.brandId, brandId)));
}

// ── Workflow steps ─────────────────────────────────────────────────────────

// One query at a time: a transaction is one connection.
async function sourcesOf(tx: Tx, brandId: string, ids: string[]) {
  const list = [];
  for (const id of ids) list.push(await getSource(tx, brandId, id));
  return list;
}

/** The run, if it is running. Locks the row, so a step enqueued by a confirm not yet committed waits for it. */
async function running(brandId: string, runId: string): Promise<RunRow> {
  const run = await withBrand(brandId, (tx) => runRow(tx, brandId, runId, true));
  if (run.state !== 'running') throw new RunStopped(`The import is ${run.state}`);
  return run;
}

async function updateRunning(brandId: string, runId: string, set: Partial<typeof importRuns.$inferInsert>): Promise<void> {
  await withBrand(brandId, async (tx) => {
    const done = await tx
      .update(importRuns)
      .set(set)
      .where(and(eq(importRuns.id, runId), eq(importRuns.state, 'running')))
      .returning({ id: importRuns.id });
    if (!done.length) throw new RunStopped('The import is no longer running');
  });
}

/** Marks the run failed: failed_final when the model's answer can never be valid, else failed_retryable. */
export async function markFailed(brandId: string, runId: string, e: unknown): Promise<void> {
  const final = e instanceof AiError && !e.retryable;
  const known = e instanceof ImportFailure || e instanceof HttpError || e instanceof AiError;
  if (!known) logger.error({ err: e, runId }, 'import step failed');
  const message = known ? (e as Error).message : 'The import stopped on an unexpected error; retry it';
  await withBrand(brandId, async (tx) => {
    const done = await tx
      .update(importRuns)
      .set({ state: final ? 'failed_final' : 'failed_retryable', error: message, finishedAt: new Date(), actual: await actualCost(tx, runId) })
      .where(and(eq(importRuns.id, runId), eq(importRuns.state, 'running')))
      .returning({ id: importRuns.id });
    if (done.length)
      await audit(tx, { brandId, actor: OPERATOR, action: 'import.fail', objectType: 'import', objectId: runId, result: 'failed', reason: message });
  });
}

/** Runs a step body; a failure marks the run failed (inside the step, so a retry re-runs it) and rethrows. */
export async function guarded<T>(brandId: string, runId: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!(e instanceof RunStopped)) await markFailed(brandId, runId, e);
    throw e;
  }
}

/** Fetches the website (free): the homepage and up to 9 more pages, each stored as a brand_site source. */
export async function fetchStage(brandId: string, runId: string): Promise<void> {
  const run = await running(brandId, runId);
  const uploads = await withBrand(brandId, async (tx) =>
    (await sourcesOf(tx, brandId, run.sourceIds)).filter((s) => s.kind === 'upload').map((s) => s.id),
  );
  const pages: string[] = [];
  let failed = 0;
  if (run.websiteUrl) {
    const urls = await pickPages(run.websiteUrl, 10).catch(() => [] as string[]);
    if (!urls.length) failed++;
    for (const url of urls) {
      try {
        pages.push((await withBrand(brandId, (tx) => savePageSource(tx, brandId, url, 'brand_site'))).id);
      } catch {
        failed++;
      }
    }
    if (!pages.length) throw new ImportFailure('could not read the website');
  }
  await updateRunning(brandId, runId, {
    sourceIds: [...pages, ...uploads], stage: 'estimate',
    counts: { ...run.counts, pages: pages.length, pagesFailed: failed, files: uploads.length },
  });
}

/** The run's sources in model batches of at most batching.maxTokens estimated tokens, in source order. */
async function planBatches(brandId: string, sourceIds: string[]): Promise<{ ids: string[]; tokens: number }[]> {
  const list = await withBrand(brandId, (tx) => sourcesOf(tx, brandId, sourceIds));
  const batches: { ids: string[]; tokens: number }[] = [];
  let current = { ids: [] as string[], tokens: 0 };
  for (const s of list) {
    const parts = sourceParts(s, isFile(s) ? await getObject(s.objectKey) : undefined);
    if (!parts.length) continue;
    const tokens = estimateTokens(parts);
    if (current.ids.length && current.tokens + tokens > batching.maxTokens) {
      batches.push(current);
      current = { ids: [], tokens: 0 };
    }
    current.ids.push(s.id);
    current.tokens += tokens;
  }
  if (current.ids.length) batches.push(current);
  return batches;
}

const systemTokens = () =>
  estimateTokens([{ type: 'text', text: EXTRACTION_SYSTEM + JSON.stringify(z.toJSONSchema(Extraction, { unrepresentable: 'any' })) }]);

/** Prices every batch at its input plus the output cap, then waits at awaiting_approval (blocked if over the cap). */
export async function estimateStage(brandId: string, runId: string): Promise<void> {
  const run = await running(brandId, runId);
  const batches = await planBatches(brandId, run.sourceIds);
  const input = batches.reduce((t, b) => t + b.tokens + systemTokens(), 0);
  const estimate = estimateCost(config.AI_MODEL, input, batches.length * MAX_OUTPUT_TOKENS);
  await withBrand(brandId, async (tx) => {
    const remaining = await remainingMonthlyCap(tx);
    const blocked = Number(estimate.npr) > Number(remaining.npr)
      ? `This import may cost NPR ${estimate.npr}; NPR ${remaining.npr} of this month's AI budget is left`
      : null;
    const done = await tx
      .update(importRuns)
      .set({ state: 'awaiting_approval', estimate, blocked, counts: { ...run.counts, batches: batches.length } })
      .where(and(eq(importRuns.id, runId), eq(importRuns.state, 'running')))
      .returning({ id: importRuns.id });
    if (!done.length) throw new RunStopped('The import is no longer running');
    await audit(tx, {
      brandId, actor: OPERATOR, action: 'import.estimate', objectType: 'import', objectId: runId, result: 'ok', reason: blocked ?? undefined,
    });
  });
}

/** The batches to extract, as source IDs. */
export async function planStage(brandId: string, runId: string): Promise<string[][]> {
  const run = await running(brandId, runId);
  return (await planBatches(brandId, run.sourceIds)).map((b) => b.ids);
}

/** One paid model call over one batch of sources. Its answer is the step's stored output. */
export async function extractStage(brandId: string, runId: string, sourceIds: string[]): Promise<ProposedFact[]> {
  await running(brandId, runId);
  const list = await withBrand(brandId, (tx) => sourcesOf(tx, brandId, sourceIds));
  const parts = [];
  for (const s of list) parts.push(...sourceParts(s, isFile(s) ? await getObject(s.objectKey) : undefined));
  const { object } = await extract({
    brandId, runType: RUN_TYPE, runId, system: EXTRACTION_SYSTEM, parts, schema: Extraction, maxOutputTokens: MAX_OUTPUT_TOKENS,
  });
  return toProposed(object);
}

/** Checks the quotes of one batch's facts against that batch's sources and stores them, finding conflicts. */
export async function verifyStage(brandId: string, runId: string, sourceIds: string[], facts: ProposedFact[]): Promise<ProposeCounts> {
  await updateRunning(brandId, runId, { stage: 'verify' });
  return withBrand(brandId, (tx) => proposeFacts(tx, brandId, runId, facts, sourceIds));
}

/**
 * Reads the brand's look (free; a failed fetch is skipped, never fails the run). When the brand has no
 * logo yet, the first logo the homepage points to is stored as a file for the owner to confirm. The
 * logos' dominant colours and the colours of the homepage and its stylesheets go into the palette
 * without roles, and the fonts its CSS uses are proposed as inferred facts for review.
 */
export async function paletteStage(brandId: string, runId: string): Promise<Partial<Counts>> {
  const run = await running(brandId, runId);
  const { keys, home } = await withBrand(brandId, async (tx) => ({
    keys: await logoKeys(tx, brandId),
    home: (await sourcesOf(tx, brandId, run.sourceIds)).find((s) => s.kind === 'page'),
  }));
  const logos: Uint8Array[] = [];
  for (const key of keys) logos.push(await getObject(key).catch(() => new Uint8Array()));
  let html = '';
  const sheets: string[] = [];
  let found = 0;
  if (home) {
    html = new TextDecoder().decode(await getObject(home.objectKey).catch(() => new Uint8Array()));
    for (const href of stylesheetLinks(html, home.uri)) sheets.push(await fetchText(href).catch(() => ''));
    for (const url of keys.length ? [] : logoCandidates(html, home.uri)) {
      try {
        logos.push((await withBrand(brandId, (tx) => saveSiteImage(tx, brandId, url))).bytes);
        found = 1;
        break;
      } catch (e) {
        logger.warn({ err: e, url }, 'site logo skipped');
      }
    }
  }
  const colours: { hex: string; origin: 'logo' | 'site'; share?: number }[] = [];
  for (const bytes of logos) {
    try {
      colours.push(...(await extractPalette(bytes)).map((c) => ({ ...c, origin: 'logo' as const })));
    } catch (e) {
      logger.warn({ err: e }, 'logo palette skipped');
    }
  }
  colours.push(...cssColours(html, sheets).map((hex) => ({ hex, origin: 'site' as const })));
  const seen = new Set<string>();
  const unique = colours.filter((c) => !seen.has(c.hex) && !!seen.add(c.hex)); // logo colours win over site ones
  const fonts: ProposedFact[] = fontFamilies(html, sheets).map((value) => ({
    section: 'visual', field: 'fonts', value, language: 'und', origin: 'inferred', confidence: 0.6,
  }));
  return withBrand(brandId, async (tx) => ({
    colours: await addColours(tx, brandId, unique), logos: found, ...(await proposeFacts(tx, brandId, runId, fonts, [])),
  }));
}

export async function finishStage(brandId: string, runId: string, found: Partial<Counts>[]): Promise<void> {
  await withBrand(brandId, async (tx) => {
    const run = await runRow(tx, brandId, runId);
    const counts = { ...ZERO, ...run.counts };
    // A run from before the palette step returned counts stored a bare number there: Object.entries skips it.
    for (const f of found) for (const [k, v] of Object.entries(f ?? {}) as [keyof Counts, number][]) counts[k] += v;
    const done = await tx
      .update(importRuns)
      .set({ state: 'completed', stage: 'done', counts, actual: await actualCost(tx, runId), finishedAt: new Date() })
      .where(and(eq(importRuns.id, runId), eq(importRuns.state, 'running')))
      .returning({ id: importRuns.id });
    if (!done.length) throw new RunStopped('The import is no longer running');
    await audit(tx, { brandId, actor: OPERATOR, action: 'import.complete', objectType: 'import', objectId: runId, result: 'ok' });
  });
}
