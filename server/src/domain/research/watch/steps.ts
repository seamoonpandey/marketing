// The steps of one watch run (workflows/research-watch.ts). Each opens its own withBrand
// transaction, and returns plain JSON, which DBOS stores so a retry does not repeat it.
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { AiError, estimateTokens, extract } from '../../../ai/index.ts';
import { config } from '../../../config.ts';
import type { Money } from '../../../contracts/common.ts';
import {
  competitorProfiles, observations, watchRuns, watchTargets, type ProfileEntry, type RunCounts,
} from '../../../db/schema/research.ts';
import { withBrand } from '../../../db/tenant.ts';
import { BudgetError } from '../../../http/errors.ts';
import { audit } from '../../audit/index.ts';
import { listCompetitors } from '../../brands/index.ts';
import { estimateCost, remainingMonthlyCap } from '../../costs/index.ts';
import { getSource, normalizeQuote, savePageSource, verifyQuote, FetchError } from '../../sources/index.ts';
import { diffText } from '../diff.ts';
import { addMoney } from './money.ts';
import {
  MAX_OUTPUT_TOKENS, OBSERVATION_SYSTEM, ObservationAnswer, PROFILE_SYSTEM, ProfileAnswer, pageParts,
} from './prompts.ts';

export type Block = { before: string; after: string };
export type Captured = {
  targetId: string; competitorId: string; url: string; sourceId: string | null; prevSourceId: string | null;
  first: boolean; changed: boolean; blocks: Block[]; error: string | null;
};
export type Target = { id: string; competitorId: string; url: string; lastSourceId: string | null };

export const runCapNpr = () => process.env.RESEARCH_RUN_CAP_NPR ?? '150';
const RUN_TYPE = 'research_watch';
const FAILS_BEFORE_PAUSE = 3;

/** Targets not paused (a failing page is tried again each run) whose competitor still exists, and the run's trigger. */
export async function loadRun(brandId: string, runId: string): Promise<{ trigger: string; targets: Target[] }> {
  return withBrand(brandId, async (tx) => {
    const [run] = await tx.select({ trigger: watchRuns.trigger }).from(watchRuns).where(eq(watchRuns.id, runId));
    const alive = new Set((await listCompetitors(tx, brandId)).map((c) => c.id));
    const rows = await tx.select().from(watchTargets).where(and(eq(watchTargets.brandId, brandId), ne(watchTargets.status, 'paused')));
    return {
      trigger: run!.trigger,
      targets: rows
        .filter((t) => alive.has(t.competitorId))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((t) => ({ id: t.id, competitorId: t.competitorId, url: t.url, lastSourceId: t.lastSourceId })),
    };
  });
}

/** Saves the page, compares its text with the last snapshot. A failing page is marked, never thrown. */
export async function capture(brandId: string, t: Target): Promise<Captured> {
  return withBrand(brandId, async (tx) => {
    const base = { targetId: t.id, competitorId: t.competitorId, url: t.url, prevSourceId: t.lastSourceId };
    let source;
    try {
      source = await savePageSource(tx, brandId, t.url, 'external');
    } catch (e) {
      const message = (e as Error).message;
      const [row] = await tx.select({ failCount: watchTargets.failCount }).from(watchTargets).where(eq(watchTargets.id, t.id));
      const failCount = (row?.failCount ?? 0) + 1;
      await tx
        .update(watchTargets)
        .set({
          failCount, lastError: message,
          status: failCount >= FAILS_BEFORE_PAUSE ? 'paused' : e instanceof FetchError && e.kind === 'robots' ? 'blocked' : 'unreachable',
        })
        .where(eq(watchTargets.id, t.id));
      return { ...base, sourceId: null, first: false, changed: false, blocks: [], error: message };
    }
    const prev = t.lastSourceId ? await getSource(tx, brandId, t.lastSourceId).catch(() => null) : null;
    const d = prev ? diffText(prev.text ?? '', source.text ?? '') : { changed: true, blocks: [] };
    // A changed page keeps its old snapshot as "last" until it has been read, so a cancelled run loses nothing.
    await tx
      .update(watchTargets)
      .set({ failCount: 0, lastError: null, status: 'active', ...(d.changed ? {} : { lastSourceId: source.id }) })
      .where(eq(watchTargets.id, t.id));
    return { ...base, sourceId: source.id, first: !prev, changed: d.changed, blocks: d.blocks, error: null };
  });
}

async function pageText(brandId: string, id: string | null): Promise<string> {
  return id ? withBrand(brandId, async (tx) => (await getSource(tx, brandId, id)).text ?? '') : '';
}

const call = (c: Captured, text: string) => ({
  system: c.first ? PROFILE_SYSTEM : OBSERVATION_SYSTEM,
  parts: pageParts(c.url, text, c.first ? null : c.blocks),
});

/** The most the changed pages can cost, and whether the owner must confirm first. */
export async function estimateRun(
  brandId: string, runId: string, trigger: string, changed: Captured[],
): Promise<{ estimate: Money; wait: boolean }> {
  const costs: Money[] = [];
  for (const c of changed) {
    const { system, parts } = call(c, await pageText(brandId, c.sourceId));
    costs.push(estimateCost(config.AI_MODEL, estimateTokens([{ type: 'text', text: system }, ...parts]), MAX_OUTPUT_TOKENS));
  }
  const estimate = addMoney(costs);
  return withBrand(brandId, async (tx) => {
    const remaining = await remainingMonthlyCap(tx);
    const wait =
      changed.length > 0 &&
      (trigger === 'baseline' || Number(estimate.npr) > Number(runCapNpr()) || Number(estimate.npr) > Number(remaining.npr));
    await tx
      .update(watchRuns)
      .set({ estimate, ...(wait ? { state: 'awaiting_approval' as const } : {}) })
      .where(and(eq(watchRuns.id, runId), eq(watchRuns.state, 'running')));
    return { estimate, wait };
  });
}

export type Extracted = { observations: number; discarded: number; profileEntries: number } | { fatal: string };

/** One model call for one changed page. Keeps only what the saved pages back up. */
export async function extractPage(brandId: string, runId: string, c: Captured): Promise<Extracted> {
  const text = await pageText(brandId, c.sourceId);
  const oldText = await pageText(brandId, c.prevSourceId);
  const { system, parts } = call(c, text);
  const ask = <T>(schema: z.ZodType<T>) =>
    extract({ brandId, runType: RUN_TYPE, runId, system, parts, maxOutputTokens: MAX_OUTPUT_TOKENS, schema }).then((r) => r.object);
  let profile: z.infer<typeof ProfileAnswer> | undefined;
  let found: z.infer<typeof ObservationAnswer> | undefined;
  try {
    if (c.first) profile = await ask(ProfileAnswer);
    else found = await ask(ObservationAnswer);
  } catch (e) {
    if (e instanceof BudgetError) return { fatal: e.message };
    if (!(e instanceof AiError) || e.retryable) throw e;
    // The page's own text made the model refuse or answer off-schema: mark this page and go on with the
    // others. Its old snapshot stays "last", so the change is read again next run.
    await withBrand(brandId, (tx) => tx.update(watchTargets).set({ lastError: e.message }).where(eq(watchTargets.id, c.targetId)));
    return { observations: 0, discarded: 0, profileEntries: 0 };
  }
  return withBrand(brandId, async (tx) => {
    let discarded = 0;
    let kept = 0;
    if (c.first) {
      const entries: ProfileEntry[] = [];
      for (const e of profile!.entries) {
        // A price is kept only when the entry's verified quote shows it.
        const price = e.price && normalizeQuote(e.quote).includes(normalizeQuote(e.price)) ? e.price : null;
        if (verifyQuote(text, e.quote)) entries.push({ kind: e.kind, text: e.text, price, quote: e.quote, url: c.url, sourceId: c.sourceId! });
        else discarded++;
      }
      kept = entries.length;
      if (entries.length) await saveProfile(tx, brandId, runId, c, entries);
    } else {
      for (const o of found!.observations) {
        if (!verifyQuote(text, o.after.quote) || (o.before && !verifyQuote(oldText, o.before.quote))) {
          discarded++;
          continue;
        }
        await tx.insert(observations).values({
          brandId, competitorId: c.competitorId, runId, type: o.type, summary: o.summary, url: c.url,
          before: o.before ? { quote: o.before.quote, sourceId: c.prevSourceId! } : null,
          after: { quote: o.after.quote, sourceId: c.sourceId! }, confidence: o.confidence,
        });
        kept++;
      }
    }
    await tx.update(watchTargets).set({ lastSourceId: c.sourceId }).where(eq(watchTargets.id, c.targetId));
    return { observations: c.first ? 0 : kept, discarded, profileEntries: c.first ? kept : 0 };
  });
}

/** This page's entries replace its old ones in the competitor's profile; other pages' entries stay. */
async function saveProfile(tx: Parameters<Parameters<typeof withBrand>[1]>[0], brandId: string, runId: string, c: Captured, entries: ProfileEntry[]) {
  const [latest] = await tx
    .select().from(competitorProfiles)
    .where(and(eq(competitorProfiles.brandId, brandId), eq(competitorProfiles.competitorId, c.competitorId)))
    .orderBy(sql`created_at desc`).limit(1);
  const merged = [...(latest?.profile.entries ?? []).filter((e) => e.url !== c.url), ...entries];
  const sourceIds = [...new Set(merged.map((e) => e.sourceId))];
  if (latest && latest.runId === runId) {
    await tx.update(competitorProfiles).set({ profile: { entries: merged }, sourceIds }).where(eq(competitorProfiles.id, latest.id));
  } else {
    await tx.insert(competitorProfiles).values({ brandId, competitorId: c.competitorId, profile: { entries: merged }, sourceIds, runId });
  }
}

export async function setRunState(
  brandId: string, runId: string, to: 'completed' | 'failed_retryable' | 'failed_final' | 'cancelled',
  patch: { error?: string; counts?: Partial<RunCounts> } = {},
): Promise<void> {
  await withBrand(brandId, async (tx) => {
    const [spent] = (
      await tx.execute<{ usd: string; npr: string }>(
        sql`select coalesce(sum(cost_usd), 0)::numeric(14,4)::text as usd, coalesce(sum(cost_npr), 0)::numeric(14,2)::text as npr
            from cost_events where run_id = ${runId}`,
      )
    ).rows;
    const [row] = await tx
      .update(watchRuns)
      .set({
        state: to, ...(patch.error ? { error: patch.error } : {}), ...(patch.counts ? { counts: patch.counts } : {}),
        finishedAt: new Date(), actual: spent!,
      })
      .where(and(eq(watchRuns.id, runId), inArray(watchRuns.state, ['running', 'awaiting_approval'])))
      .returning({ id: watchRuns.id });
    if (row)
      await audit(tx, {
        brandId, actor: 'system', action: `research.run.${to}`, objectType: 'watch_run', objectId: runId,
        result: to === 'completed' || to === 'cancelled' ? 'ok' : 'failed', reason: patch.error,
      });
  });
}
