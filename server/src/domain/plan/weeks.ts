import { and, asc, desc, eq, gte, inArray, lt } from 'drizzle-orm';
import type { ApprovedFact } from '../../contracts/common.ts';
import { planItems, weekPlans } from '../../db/schema/plan.ts';
import type { Tx } from '../../db/tenant.ts';
import { ConflictError, NotFoundError, ValidationError } from '../../http/errors.ts';
import { audit } from '../audit/index.ts';
import { checkBalance, type PlanItem, type Violation } from './balance.ts';
import { getCampaign } from './campaigns.ts';
import { addDays, isDay, UUID, weekdayOf } from './dates.ts';
import { getSettings } from './settings.ts';

export type WeekPlan = typeof weekPlans.$inferSelect;
export type ItemInput = Partial<Pick<PlanItem, 'format' | 'pillar' | 'funnel' | 'intent' | 'segmentId' | 'campaignId' | 'idea' | 'cta' | 'factIds'>>;

/** 400 unless weekStart is a real date on the brand's first day of the week. */
export async function assertWeekStart(tx: Tx, brandId: string, weekStart: string): Promise<void> {
  if (!isDay(weekStart)) throw new ValidationError('weekStart must be a date, YYYY-MM-DD');
  const { weekStarts } = await getSettings(tx, brandId);
  if (weekdayOf(weekStart) !== weekStarts)
    throw new ValidationError(`${weekStart} is not the first day of the week; the plan settings start weeks on weekday ${weekStarts} (0 Sunday … 6 Saturday)`);
}

/** The plan being worked on (the newest draft, else the approved one) and the approval that still stands. */
export async function currentPlans(tx: Tx, brandId: string, weekStart: string): Promise<{ plan: WeekPlan | null; approvedPlan: WeekPlan | null }> {
  const rows = await tx.select().from(weekPlans)
    .where(and(eq(weekPlans.brandId, brandId), eq(weekPlans.weekStart, weekStart), inArray(weekPlans.status, ['draft', 'approved'])))
    .orderBy(desc(weekPlans.version));
  const approved = rows.find((r) => r.status === 'approved') ?? null;
  const draft = rows.find((r) => r.status === 'draft' && (!approved || r.version > approved.version)) ?? null;
  return { plan: draft ?? approved, approvedPlan: draft ? approved : null };
}

export const listItems = (tx: Tx, planId: string) =>
  tx.select().from(planItems).where(eq(planItems.weekPlanId, planId)).orderBy(asc(planItems.day), asc(planItems.position), asc(planItems.createdAt));

/** Ideas of the approved plans of the four weeks before `weekStart`. */
export async function recentIdeas(tx: Tx, brandId: string, weekStart: string): Promise<string[]> {
  const plans = await tx.select({ id: weekPlans.id }).from(weekPlans).where(
    and(eq(weekPlans.brandId, brandId), eq(weekPlans.status, 'approved'), gte(weekPlans.weekStart, addDays(weekStart, -28)), lt(weekPlans.weekStart, weekStart)),
  );
  if (!plans.length) return [];
  return (await tx.select({ idea: planItems.idea }).from(planItems).where(inArray(planItems.weekPlanId, plans.map((p) => p.id)))).map((r) => r.idea);
}

export async function getWeek(tx: Tx, brandId: string, weekStart: string, facts: ApprovedFact[]) {
  await assertWeekStart(tx, brandId, weekStart);
  const { plan, approvedPlan } = await currentPlans(tx, brandId, weekStart);
  if (!plan) return { plan, approvedPlan, items: [] as PlanItem[], violations: [] as Violation[] };
  const items = await listItems(tx, plan.id);
  const violations = checkBalance({
    items, settings: await getSettings(tx, brandId), factIds: new Set(facts.map((f) => f.id)), recentIdeas: await recentIdeas(tx, brandId, weekStart),
  });
  return { plan, approvedPlan, items, violations };
}

async function checkRefs(tx: Tx, brandId: string, i: ItemInput) {
  for (const f of i.factIds ?? []) if (!UUID.test(f)) throw new ValidationError('factIds must be fact ids');
  if (i.segmentId && !UUID.test(i.segmentId)) throw new ValidationError('segmentId is not an id');
  if (i.campaignId) await getCampaign(tx, brandId, i.campaignId); // 404 (denied) for another brand's campaign
}

/** A change to an approved plan puts it back to draft and records that the approval ended. */
async function invalidate(tx: Tx, brandId: string, read: WeekPlan): Promise<void> {
  // Re-read under a lock: an approval committed since `read` must be seen, and none may commit until this change does.
  const [plan] = await tx.select().from(weekPlans).where(eq(weekPlans.id, read.id)).for('update');
  if (!plan) throw new NotFoundError('week_plan', read.id);
  if (plan.status === 'replaced') throw new ConflictError('That plan was replaced by a newer version');
  if (plan.status !== 'approved') return;
  const { plan: current } = await currentPlans(tx, brandId, plan.weekStart);
  if (current && current.id !== plan.id) throw new ConflictError('A newer draft exists for this week; edit that one');
  await tx.update(weekPlans).set({ status: 'draft', approvedAt: null }).where(eq(weekPlans.id, plan.id));
  await audit(tx, { brandId, actor: 'operator', action: 'approval_invalidated', objectType: 'week_plan', objectId: plan.id, objectVersion: plan.version, result: 'ok', reason: 'item changed' });
}

export async function getPlan(tx: Tx, brandId: string, id: string): Promise<WeekPlan> {
  const [row] = UUID.test(id) ? await tx.select().from(weekPlans).where(and(eq(weekPlans.id, id), eq(weekPlans.brandId, brandId))) : [];
  if (!row) throw new NotFoundError('week_plan', id);
  return row;
}

export async function getItem(tx: Tx, brandId: string, id: string): Promise<PlanItem> {
  const [row] = UUID.test(id) ? await tx.select().from(planItems).where(and(eq(planItems.id, id), eq(planItems.brandId, brandId))) : [];
  if (!row) throw new NotFoundError('plan_item', id);
  return row;
}

const inWeek = (plan: Pick<WeekPlan, 'weekStart'>, day: string) => {
  if (!isDay(day) || day < plan.weekStart || day > addDays(plan.weekStart, 6)) throw new ValidationError(`${day} is outside the week of ${plan.weekStart}`);
};

export async function addItem(tx: Tx, brandId: string, weekStart: string, i: ItemInput & { day: string; channel: PlanItem['channel'] }): Promise<PlanItem> {
  await assertWeekStart(tx, brandId, weekStart);
  inWeek({ weekStart }, i.day);
  await checkRefs(tx, brandId, i);
  let { plan } = await currentPlans(tx, brandId, weekStart);
  if (!plan) {
    [plan] = await tx.insert(weekPlans).values({ brandId, weekStart, version: await nextVersion(tx, brandId, weekStart), status: 'draft' }).returning();
  } else await invalidate(tx, brandId, plan);
  const existing = await listItems(tx, plan!.id);
  const [row] = await tx.insert(planItems).values({ ...i, brandId, weekPlanId: plan!.id, position: existing.length, origin: 'owner' }).returning();
  await audit(tx, { brandId, actor: 'operator', action: 'plan.item.add', objectType: 'plan_item', objectId: row!.id, result: 'ok' });
  return row!;
}

export async function nextVersion(tx: Tx, brandId: string, weekStart: string): Promise<number> {
  const [last] = await tx.select({ v: weekPlans.version }).from(weekPlans)
    .where(and(eq(weekPlans.brandId, brandId), eq(weekPlans.weekStart, weekStart))).orderBy(desc(weekPlans.version)).limit(1);
  return (last?.v ?? 0) + 1;
}

export async function editItem(tx: Tx, brandId: string, id: string, patch: ItemInput & { day?: string; channel?: PlanItem['channel'] }): Promise<PlanItem> {
  const item = await getItem(tx, brandId, id);
  const plan = await getPlan(tx, brandId, item.weekPlanId);
  if (patch.day !== undefined) inWeek(plan, patch.day);
  await checkRefs(tx, brandId, patch);
  await invalidate(tx, brandId, plan);
  const set = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
  const [row] = Object.keys(set).length ? await tx.update(planItems).set(set).where(eq(planItems.id, id)).returning() : [item];
  await audit(tx, { brandId, actor: 'operator', action: 'plan.item.edit', objectType: 'plan_item', objectId: id, result: 'ok' });
  return row!;
}

export async function removeItem(tx: Tx, brandId: string, id: string): Promise<void> {
  const item = await getItem(tx, brandId, id);
  await invalidate(tx, brandId, await getPlan(tx, brandId, item.weekPlanId));
  await tx.delete(planItems).where(eq(planItems.id, id));
  await audit(tx, { brandId, actor: 'operator', action: 'plan.item.remove', objectType: 'plan_item', objectId: id, result: 'ok' });
}

/** The reason a week cannot be approved now, or null. */
export const approvalBlocker = (plan: WeekPlan | null, items: PlanItem[], violations: Violation[]): string | null =>
  !plan ? 'This week has no plan yet'
    : plan.status === 'approved' ? 'This plan is already approved'
    : !items.length ? 'The plan has no items'
    : violations.find((v) => v.blocking)?.message ?? null;

export async function approveWeek(tx: Tx, brandId: string, weekStart: string, facts: ApprovedFact[], version: number): Promise<WeekPlan> {
  await assertWeekStart(tx, brandId, weekStart);
  // Item changes lock their plan (invalidate), so the items checked below are the items approved.
  await tx.select({ id: weekPlans.id }).from(weekPlans).where(and(eq(weekPlans.brandId, brandId), eq(weekPlans.weekStart, weekStart))).for('update');
  const { plan, items, violations } = await getWeek(tx, brandId, weekStart, facts);
  // Same lock as the item edits: no draft can land between this check and the approval.
  if (plan && plan.version !== version) throw new ConflictError('This plan changed since you opened it; look at it again before approving');
  if (plan?.status === 'approved') return plan;
  const blocker = approvalBlocker(plan, items, violations);
  if (blocker) throw new ConflictError(`Cannot approve: ${blocker}`);
  await tx.update(weekPlans).set({ status: 'replaced' })
    .where(and(eq(weekPlans.brandId, brandId), eq(weekPlans.weekStart, weekStart), eq(weekPlans.status, 'approved')));
  const [row] = await tx.update(weekPlans).set({ status: 'approved', approvedAt: new Date() }).where(eq(weekPlans.id, plan!.id)).returning();
  await audit(tx, { brandId, actor: 'operator', action: 'plan.week.approve', objectType: 'week_plan', objectId: plan!.id, objectVersion: plan!.version, result: 'ok' });
  return row!;
}
