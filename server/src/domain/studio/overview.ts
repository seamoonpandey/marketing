import { and, eq, inArray, sql } from 'drizzle-orm';
import type { ApprovedFact, Money } from '../../contracts/common.ts';
import { studioDrafts } from '../../db/schema/studio.ts';
import type { Tx } from '../../db/tenant.ts';
import { presignDownload } from '../../storage/index.ts';
import { getBrand } from '../brands/index.ts';
import { getSettings, getWeek, listItems, todayIn, weekStartOf } from '../plan/index.ts';
import { kindFor } from './compose.ts';
import { buildView } from './drafts.ts';
import { loadEnv } from './env.ts';
import { latestRun } from './runs.ts';

/** This month's (UTC) spend of the brand on studio copy. */
export async function monthCost(tx: Tx, brandId: string): Promise<Money> {
  const { rows } = await tx.execute<Money>(sql`
    select coalesce(sum(cost_usd), 0)::numeric(14,4)::text as usd, coalesce(sum(cost_npr), 0)::numeric(14,2)::text as npr
    from cost_events where brand_id = ${brandId} and run_type = 'studio_copy' and created_at >= date_trunc('month', now(), 'UTC')`);
  return rows[0]!;
}

/** The week's approved plan items with each draft's state, so the dashboard needs one call. */
export async function overview(tx: Tx, brandId: string, weekStart: string | undefined, facts: ApprovedFact[]) {
  const settings = await getSettings(tx, brandId);
  const ws = weekStart ?? weekStartOf(todayIn((await getBrand(tx, brandId)).timezone), settings.weekStarts);
  const w = await getWeek(tx, brandId, ws, facts); // 400 unless ws is the first day of the brand's week
  const approved = w.plan?.status === 'approved' ? w.plan : w.approvedPlan;
  const items = !approved ? [] : approved.id === w.plan?.id ? w.items : await listItems(tx, approved.id);
  const ids = items.map((i) => i.id);
  const rows = ids.length ? await tx.select().from(studioDrafts).where(and(eq(studioDrafts.brandId, brandId), inArray(studioDrafts.planItemId, ids))) : [];
  const env = await loadEnv(tx, brandId);
  const cards = new Map<string, { id: string; kind: string; status: 'draft' | 'ready'; currentVersion: number; blockingCount: number; thumbnailKey: string | null }>();
  for (const d of rows) {
    const v = await buildView(tx, brandId, d, facts, env);
    const first = v.renders.filter((r) => r.type === 'image' && r.index === 0)[0];
    cards.set(d.planItemId, { id: d.id, kind: d.kind, status: d.status, currentVersion: d.currentVersion, blockingCount: v.blockingCount, thumbnailKey: first?.key ?? null });
  }
  return {
    weekStart: ws, planApproved: !!approved, ready: { facts: facts.length > 0 },
    items: await Promise.all(items.map(async (i) => {
      const c = cards.get(i.id);
      return {
        item: { id: i.id, day: i.day, channel: i.channel, format: i.format, idea: i.idea, cta: i.cta, kind: kindFor(i.format) },
        draft: c ? { id: c.id, kind: c.kind, status: c.status, currentVersion: c.currentVersion, blockingCount: c.blockingCount, thumbnailUrl: c.thumbnailKey ? await presignDownload(c.thumbnailKey) : null } : null,
      };
    })),
    latestRun: ids.length ? await latestRun(tx, brandId, 'generate', ids) : null,
    monthCost: await monthCost(tx, brandId),
  };
}
