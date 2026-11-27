// The studio run: copy for several plan items, or the render of one draft. The run ID is the DBOS
// workflow ID of the first attempt; a retry starts a new workflow for the same run. Owned by the studio branch.
import { DBOS } from '@dbos-inc/dbos-sdk';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { ApprovedFact, Money } from '../contracts/common.ts';
import { studioRuns, type StudioCounts } from '../db/schema/studio.ts';
import { withBrand } from '../db/tenant.ts';
import { generateOne, type ItemResult } from '../domain/studio/generate.ts';
import { pendingRenderers, renderDraft } from '../domain/studio/rendering.ts';
import { isFinal, runError } from './index.ts';

type End = 'completed' | 'failed_retryable' | 'failed_final';

/** Moves a still-active run to its end state; a run that already ended (cancelled) is left alone. */
async function setRunState(brandId: string, runId: string, state: End, o: { error?: string | null; counts?: StudioCounts } = {}): Promise<void> {
  await withBrand(brandId, async (tx) => {
    const [r] = await tx.select({ id: studioRuns.id }).from(studioRuns).where(and(eq(studioRuns.id, runId), eq(studioRuns.brandId, brandId), eq(studioRuns.state, 'running')));
    if (!r) return;
    // What the model cost this run so far, retries included, from the cost rows that ai.extract wrote.
    const { rows } = await tx.execute<Money>(sql`
      select coalesce(sum(cost_usd), 0)::numeric(14,4)::text as usd, coalesce(sum(cost_npr), 0)::numeric(14,2)::text as npr
      from cost_events where brand_id = ${brandId} and run_id = ${runId}`);
    await tx.update(studioRuns)
      .set({ state, error: o.error ?? null, finishedAt: new Date(), actual: rows[0]!, ...(o.counts ? { counts: o.counts } : {}) })
      .where(and(eq(studioRuns.id, runId), inArray(studioRuns.state, ['running', 'awaiting_approval'])));
  });
}

async function finishGenerate(brandId: string, runId: string, results: ItemResult[]): Promise<void> {
  const prev = await withBrand(brandId, async (tx) => (await tx.select({ c: studioRuns.counts }).from(studioRuns).where(eq(studioRuns.id, runId)))[0]?.c ?? {});
  const ok = results.filter((r): r is Extract<ItemResult, { ok: true }> => r.ok);
  const bad = results.filter((r): r is Extract<ItemResult, { ok: false }> => !r.ok);
  const missing = ok.filter((r) => r.missing.length).map((r) => ({ planItemId: r.planItemId, languages: r.missing }));
  const counts: StudioCounts = {
    drafted: (prev.drafted ?? 0) + ok.length, failed: bad.length, failures: bad.map((b) => ({ planItemId: b.planItemId, message: b.message })),
    missingLanguages: [...(prev.missingLanguages ?? []), ...missing],
  };
  // Completed when anything was drafted; when every item failed the run fails, retryably unless every failure was final.
  if (counts.drafted) return setRunState(brandId, runId, 'completed', { counts });
  const retryable = bad.some((b) => b.retryable);
  await setRunState(brandId, runId, retryable ? 'failed_retryable' : 'failed_final', { counts, error: bad[0]?.message ?? 'Nothing was drafted' });
}

export const studioWorkflow = DBOS.registerWorkflow(
  async (brandId: string, runId: string, kind: 'generate' | 'render', targets: string[], facts: ApprovedFact[]): Promise<void> => {
    try {
      if (kind === 'generate') {
        const results: ItemResult[] = [];
        // One step per plan item: a failed item is a stored result, so the others are kept and a retry does not repeat them.
        for (const [n, id] of targets.entries()) results.push(await DBOS.runStep(() => generateOne(brandId, runId, id, facts), { name: `item-${n}` }));
        await DBOS.runStep(() => finishGenerate(brandId, runId, results), { name: 'finish' });
      } else {
        const r = await DBOS.runStep(() => renderDraft(brandId, runId, targets[0]!), { name: 'render' });
        await DBOS.runStep(() => setRunState(brandId, runId, 'completed', { counts: { rendered: r.rendered }, error: r.note ?? null }), { name: 'finish' });
      }
    } catch (e) {
      await DBOS.runStep(() => setRunState(brandId, runId, isFinal(e) ? 'failed_final' : 'failed_retryable', { error: runError(e).slice(0, 500) }), { name: 'fail' }).catch(() => {});
      throw e;
    } finally {
      pendingRenderers.delete(runId);
    }
  },
  { name: 'studioRun' },
);
