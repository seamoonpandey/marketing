import { sql } from 'drizzle-orm';
import type { ApprovedFact } from '../../contracts/common.ts';
import type { Money } from '../../contracts/common.ts';
import type { Tx } from '../../db/tenant.ts';
import { getBrand } from '../brands/index.ts';
import { listOpportunities } from '../research/index.ts';
import { approvalBlocker, getWeek } from './weeks.ts';
import { currentBrief } from './brief.ts';
import { getCampaign, listCampaigns } from './campaigns.ts';
import { addDays, todayIn, weekStartOf } from './dates.ts';
import { latestRun } from './draft.ts';
import { getSettings } from './settings.ts';

const ready = async (tx: Tx, brandId: string, facts: ApprovedFact[]) => ({ facts: facts.length > 0, channels: (await getSettings(tx, brandId)).channels.length > 0 });

/** One week with everything its calendar screen shows. */
export async function weekView(tx: Tx, brandId: string, weekStart: string, facts: ApprovedFact[]) {
  const w = await getWeek(tx, brandId, weekStart, facts);
  const cited = new Set(w.items.flatMap((i) => i.factIds));
  const blocker = approvalBlocker(w.plan, w.items, w.violations);
  return {
    weekStart, plan: w.plan, approvedPlan: w.approvedPlan, items: w.items, violations: w.violations,
    blockingCount: w.violations.filter((v) => v.blocking).length,
    canApprove: blocker === null, cannotApproveReason: blocker,
    facts: facts.filter((f) => cited.has(f.id)),
    latestRun: await latestRun(tx, brandId, 'week', weekStart),
    ready: await ready(tx, brandId, facts),
  };
}

/** One campaign's brief with the facts it cites. */
export async function briefView(tx: Tx, brandId: string, campaignId: string, facts: ApprovedFact[]) {
  const campaign = await getCampaign(tx, brandId, campaignId);
  const { approved, draft } = await currentBrief(tx, brandId, campaignId);
  const cited = new Set<string>();
  for (const b of [approved, draft])
    for (const list of Object.values((b?.body ?? {}) as Record<string, { factIds?: string[] }[]>)) for (const s of list) for (const f of s.factIds ?? []) cited.add(f);
  return {
    campaign, approved, draft, facts: facts.filter((f) => cited.has(f.id)),
    latestRun: await latestRun(tx, brandId, 'brief', campaignId), ready: await ready(tx, brandId, facts),
  };
}

/** This month's (UTC) spend of the brand on plan runs. */
async function monthCost(tx: Tx, brandId: string): Promise<Money> {
  const { rows } = await tx.execute<{ usd: string; npr: string }>(sql`
    select coalesce(sum(cost_usd), 0)::numeric(14,4)::text as usd, coalesce(sum(cost_npr), 0)::numeric(14,2)::text as npr
    from cost_events where brand_id = ${brandId} and run_type in ('plan_week', 'plan_brief') and created_at >= date_trunc('month', now(), 'UTC')`);
  return rows[0]!;
}

export async function overview(tx: Tx, brandId: string, facts: ApprovedFact[]) {
  const brand = await getBrand(tx, brandId);
  const settings = await getSettings(tx, brandId);
  const first = weekStartOf(todayIn(brand.timezone), settings.weekStarts);
  const weeks = [];
  for (const weekStart of [first, addDays(first, 7)]) {
    const v = await weekView(tx, brandId, weekStart, facts);
    weeks.push({ weekStart, status: (v.plan?.status ?? 'none') as 'none' | 'draft' | 'approved', itemCount: v.items.length, blockingCount: v.blockingCount, latestRun: v.latestRun });
  }
  const used = new Set((await listCampaigns(tx, brandId)).map((c) => c.opportunityId));
  return {
    ready: await ready(tx, brandId, facts), weeks, activeCampaigns: await listCampaigns(tx, brandId, 'active'),
    opportunities: (await listOpportunities(tx, brandId, 'accepted')).filter((o) => !used.has(o.id)), monthCost: await monthCost(tx, brandId),
  };
}
