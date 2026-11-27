import { DBOS } from '@dbos-inc/dbos-sdk';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { watchRuns, watchSchedules } from '../../../db/schema/research.ts';
import { withBrand, withTenant, type Tx } from '../../../db/tenant.ts';
import { ConflictError, NotFoundError, ValidationError } from '../../../http/errors.ts';
import { QUEUE, retryWorkflow } from '../../../workflows/index.ts';
import { watchWorkflow } from '../../../workflows/research-watch.ts';
import { audit } from '../../audit/index.ts';
import { listBrands } from '../../brands/index.ts';

export type WatchRun = typeof watchRuns.$inferSelect;
export type Schedule = { enabled: boolean; weekday: number; hour: number; lastRunAt: Date | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIVE = ['running', 'awaiting_approval'] as const;
const isUnique = (e: unknown) => [e, (e as { cause?: unknown })?.cause].some((x) => (x as { code?: string })?.code === '23505');
const ACTIVE_MESSAGE = 'A research run is already in progress for this brand';

/** Creates the run row, then queues its workflow (the workflow ID is the run ID). 409 if a run is active. */
export async function startRun(brandId: string, trigger: 'baseline' | 'weekly' | 'manual'): Promise<{ runId: string }> {
  const runId = await withBrand(brandId, async (tx) => {
    if ((await tx.select({ id: watchRuns.id }).from(watchRuns).where(and(eq(watchRuns.brandId, brandId), inArray(watchRuns.state, [...ACTIVE])))).length)
      throw new ConflictError(ACTIVE_MESSAGE);
    const id = (await tx.execute<{ id: string }>(sql`select uuidv7() as id`)).rows[0]!.id;
    try {
      await tx.insert(watchRuns).values({ id, brandId, trigger, state: 'running', startedAt: new Date(), workflowId: id });
    } catch (e) {
      if (isUnique(e)) throw new ConflictError(ACTIVE_MESSAGE);
      throw e;
    }
    if (trigger === 'weekly')
      await tx.insert(watchSchedules).values({ brandId, lastRunAt: new Date() })
        .onConflictDoUpdate({ target: watchSchedules.brandId, set: { lastRunAt: new Date() } });
    await audit(tx, { brandId, actor: trigger === 'weekly' ? 'system' : 'operator', action: 'research.run.start', objectType: 'watch_run', objectId: id, result: 'ok', reason: trigger });
    return id;
  });
  await DBOS.startWorkflow(watchWorkflow, { queueName: QUEUE, workflowID: runId })(brandId, runId);
  return { runId };
}

export async function getRun(tx: Tx, brandId: string, runId: string): Promise<WatchRun> {
  const [row] = UUID.test(runId)
    ? await tx.select().from(watchRuns).where(and(eq(watchRuns.id, runId), eq(watchRuns.brandId, brandId)))
    : [];
  if (!row) throw new NotFoundError('watch_run', runId);
  return row;
}

export async function listRuns(tx: Tx, brandId: string): Promise<WatchRun[]> {
  return tx.select().from(watchRuns).where(eq(watchRuns.brandId, brandId)).orderBy(desc(watchRuns.createdAt)).limit(50);
}

/** The owner accepts the estimate of a run waiting at awaiting_approval. */
export async function confirmRun(brandId: string, runId: string): Promise<void> {
  const run = await withBrand(brandId, async (tx) => {
    const r = await getRun(tx, brandId, runId);
    if (r.state !== 'awaiting_approval') throw new ConflictError('This run is not waiting for approval');
    await tx.update(watchRuns).set({ state: 'running' }).where(eq(watchRuns.id, runId));
    await audit(tx, { brandId, actor: 'operator', action: 'research.run.confirm', objectType: 'watch_run', objectId: runId, result: 'ok' });
    return r;
  });
  await DBOS.send(run.workflowId ?? runId, 'confirmed', 'approval');
}

export async function cancelRun(brandId: string, runId: string): Promise<void> {
  const run = await withBrand(brandId, async (tx) => {
    const r = await getRun(tx, brandId, runId);
    if (!(ACTIVE as readonly string[]).includes(r.state)) throw new ConflictError('This run has already finished');
    await tx.update(watchRuns).set({ state: 'cancelled', finishedAt: new Date() }).where(eq(watchRuns.id, runId));
    await audit(tx, { brandId, actor: 'operator', action: 'research.run.cancel', objectType: 'watch_run', objectId: runId, result: 'ok' });
    return r;
  });
  await DBOS.cancelWorkflow(run.workflowId ?? runId);
}

/** Restarts a failed run from its first failed step; earlier steps (and their paid calls) are not repeated. */
export async function retryRun(brandId: string, runId: string): Promise<void> {
  const run = await withBrand(brandId, async (tx) => {
    const r = await getRun(tx, brandId, runId);
    if (r.state !== 'failed_retryable') throw new ConflictError('Only a run that failed with a retryable error can be retried');
    try {
      await tx.update(watchRuns).set({ state: 'running', error: null, finishedAt: null }).where(eq(watchRuns.id, runId));
    } catch (e) {
      if (isUnique(e)) throw new ConflictError(ACTIVE_MESSAGE);
      throw e;
    }
    await audit(tx, { brandId, actor: 'operator', action: 'research.run.retry', objectType: 'watch_run', objectId: runId, result: 'ok' });
    return r;
  });
  const handle = await retryWorkflow(run.workflowId ?? runId);
  await withBrand(brandId, (tx) => tx.update(watchRuns).set({ workflowId: handle.workflowID }).where(eq(watchRuns.id, runId)));
}

const DEFAULT: Schedule = { enabled: false, weekday: 1, hour: 6, lastRunAt: null };

export async function getSchedule(tx: Tx, brandId: string): Promise<Schedule> {
  const [row] = await tx.select().from(watchSchedules).where(eq(watchSchedules.brandId, brandId));
  return row ? { enabled: row.enabled, weekday: row.weekday, hour: row.hour, lastRunAt: row.lastRunAt } : DEFAULT;
}

export async function setSchedule(tx: Tx, brandId: string, s: { enabled: boolean; weekday: number; hour: number }): Promise<Schedule> {
  if (!Number.isInteger(s.weekday) || s.weekday < 0 || s.weekday > 6) throw new ValidationError('weekday is 0 (Sunday) to 6 (Saturday)');
  if (!Number.isInteger(s.hour) || s.hour < 0 || s.hour > 23) throw new ValidationError('hour is 0 to 23');
  await tx.insert(watchSchedules).values({ brandId, ...s }).onConflictDoUpdate({ target: watchSchedules.brandId, set: s });
  await audit(tx, { brandId, actor: 'operator', action: 'research.schedule.set', objectType: 'watch_schedule', objectId: brandId, result: 'ok' });
  return getSchedule(tx, brandId);
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Brands whose schedule is on, whose local weekday and hour match `now`, and that have not run for 6 days. */
export async function dueBrands(now: Date): Promise<string[]> {
  const all = (await withTenant(listBrands)).filter((b) => b.status === 'active');
  const due: string[] = [];
  for (const b of all) {
    const s = await withBrand(b.id, (tx) => getSchedule(tx, b.id));
    if (!s.enabled || (s.lastRunAt && now.getTime() - s.lastRunAt.getTime() < 6 * 86_400_000)) continue;
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: b.timezone, weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)!.value;
    if (DAYS.indexOf(get('weekday')) === s.weekday && Number(get('hour')) === s.hour) due.push(b.id);
  }
  return due;
}
