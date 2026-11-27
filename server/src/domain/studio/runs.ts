// Starting, reading, cancelling and retrying studio runs. The workflow itself is workflows/studio-run.ts.
import { DBOS } from '@dbos-inc/dbos-sdk';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { ApprovedFact, Money } from '../../contracts/common.ts';
import { studioRuns } from '../../db/schema/studio.ts';
import { isUuid, withBrand, type Tx } from '../../db/tenant.ts';
import { ConflictError, NotFoundError } from '../../http/errors.ts';
import { cancelRun as cancelRunIn, QUEUE } from '../../workflows/index.ts';
import { studioWorkflow } from '../../workflows/studio-run.ts';
import { audit } from '../audit/index.ts';
import { assertDraftable, estimateDrafts } from './generate.ts';
import { getDraftRow, type StudioRunRow } from './drafts.ts';
import { pendingRenderers } from './rendering.ts';
import type { Renderer } from '../../render/index.ts';

const FREE: Money = { usd: '0.0000', npr: '0.00' };
export { estimateDrafts };

export async function getRun(tx: Tx, brandId: string, runId: string): Promise<StudioRunRow> {
  const [row] = isUuid(runId) ? await tx.select().from(studioRuns).where(and(eq(studioRuns.id, runId), eq(studioRuns.brandId, brandId))) : [];
  if (!row) throw new NotFoundError('studio_run', runId);
  return row;
}

/** The newest run (of the last 50) whose targets include any of the ids. */
export async function latestRun(tx: Tx, brandId: string, kind: 'generate' | 'render' | undefined, ids: string[]): Promise<StudioRunRow | null> {
  const rows = await tx.select().from(studioRuns).where(and(eq(studioRuns.brandId, brandId), kind ? eq(studioRuns.kind, kind) : undefined)).orderBy(desc(studioRuns.createdAt)).limit(50);
  return rows.find((r) => r.targets.some((t) => ids.includes(t))) ?? null;
}

async function begin(brandId: string, kind: 'generate' | 'render', targets: string[], estimate: Money, check: (tx: Tx) => Promise<void>): Promise<string> {
  return withBrand(brandId, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`studio-run:${brandId}`}))`); // one start per brand at a time, so check then insert holds
    await check(tx);
    const id = (await tx.execute<{ id: string }>(sql`select uuidv7() as id`)).rows[0]!.id;
    await tx.insert(studioRuns).values({ id, brandId, kind, targets, state: 'running', startedAt: new Date(), workflowId: id, estimate });
    await audit(tx, { brandId, actor: 'operator', action: 'studio.run.start', objectType: 'studio_run', objectId: id, result: 'ok', reason: kind });
    return id;
  });
}

/** Refused before any run row or model call: another brand's item (404), an unapproved week or an item that has a draft (409), no approved fact (400). */
export async function startGenerate(brandId: string, planItemIds: string[], facts: ApprovedFact[]): Promise<{ runId: string }> {
  const ids = [...new Set(planItemIds)];
  const estimate = await estimateDrafts(brandId, ids, facts);
  const runId = await begin(brandId, 'generate', ids, estimate, async (tx) => {
    for (const id of ids) await assertDraftable(tx, brandId, id);
    // An item has no draft until its model call returns; a second run for it then would pay twice.
    const active = await tx.select({ targets: studioRuns.targets }).from(studioRuns)
      .where(and(eq(studioRuns.brandId, brandId), eq(studioRuns.kind, 'generate'), eq(studioRuns.state, 'running')));
    if (active.some((r) => r.targets.some((t) => ids.includes(t)))) throw new ConflictError('A plan item here is already being drafted; wait for that run');
  });
  await DBOS.startWorkflow(studioWorkflow, { queueName: QUEUE, workflowID: runId })(brandId, runId, 'generate', ids, facts);
  return { runId };
}

/** Renders the current version. The Renderer defaults to the real engine, loaded when the step runs. */
export async function startRender(brandId: string, draftId: string, renderer?: Renderer): Promise<{ runId: string }> {
  const runId = await begin(brandId, 'render', [draftId], FREE, async (tx) => {
    const d = await getDraftRow(tx, brandId, draftId);
    if (d.kind === 'post') throw new ConflictError('A text post has nothing to render');
    const [active] = (await tx.select().from(studioRuns).where(and(eq(studioRuns.brandId, brandId), eq(studioRuns.kind, 'render'), eq(studioRuns.state, 'running')))).filter((r) => r.targets.includes(draftId));
    if (active) throw new ConflictError('This draft is already being rendered');
  });
  if (renderer) pendingRenderers.set(runId, renderer);
  await DBOS.startWorkflow(studioWorkflow, { queueName: QUEUE, workflowID: runId })(brandId, runId, 'render', [draftId], []);
  return { runId };
}

export const cancelRun = (brandId: string, runId: string) =>
  cancelRunIn({ table: studioRuns, get: getRun, action: 'studio.run', objectType: 'studio_run' }, brandId, runId);

/**
 * Redoes only what failed: the plan items whose copy failed (a finished run that lists failures, or one
 * that failed retryably), or the render. Drafts already stored are not touched and not paid for again.
 */
export async function retryRun(brandId: string, runId: string, facts: ApprovedFact[]): Promise<void> {
  const workflowId = `${runId}:retry:${randomUUID()}`;
  const { run, targets } = await withBrand(brandId, async (tx) => {
    const r = await getRun(tx, brandId, runId);
    const failures = r.counts.failures ?? [];
    const ok = r.state === 'failed_retryable' || (r.state === 'completed' && r.kind === 'generate' && failures.length > 0);
    if (!ok) throw new ConflictError('Only a run that failed, or finished with failed items, can be retried');
    const targets = r.kind === 'generate' && failures.length ? failures.map((f) => f.planItemId) : r.targets;
    if (!targets.length) throw new ConflictError('Nothing to retry');
    // Only from the state just read: of two retries at once, the second finds the run running and is refused.
    const [moved] = await tx.update(studioRuns).set({ state: 'running', error: null, finishedAt: null, workflowId })
      .where(and(eq(studioRuns.id, runId), eq(studioRuns.state, r.state))).returning({ id: studioRuns.id });
    if (!moved) throw new ConflictError('This run is already being retried');
    await audit(tx, { brandId, actor: 'operator', action: 'studio.run.retry', objectType: 'studio_run', objectId: runId, result: 'ok' });
    return { run: r, targets };
  });
  await DBOS.startWorkflow(studioWorkflow, { queueName: QUEUE, workflowID: workflowId })(brandId, runId, run.kind, targets, run.kind === 'generate' ? facts : []);
}
