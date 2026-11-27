// Home: reads every module's summary through its index.ts and ranks what needs the owner. It owns no table.
import type { z } from '@hono/zod-openapi';
import { modules, type Home } from '../../contracts/home.ts';
import { withBrand, type Tx } from '../../db/tenant.ts';
import { queue, validApproval } from '../approve/index.ts';
import { getBrand } from '../brands/index.ts';
import { todayIn } from '../plan/index.ts';
import { brandCosts } from '../costs/index.ts';
import { summary as publishSummary } from '../publish/index.ts';
import { getDraft, listDrafts } from '../studio/index.ts';
import * as collect from './collect.ts';
import { rank } from './rank.ts';

export { routes } from './routes.ts';
export { rank, type Item } from './rank.ts';

export type Readers = { studio: Parameters<typeof queue>[3]; publish: Parameters<typeof publishSummary>[2] };
/** Where Home gets Studio's drafts and the Approve gate from. Tests swap them for fakes, as with fetchGuard. */
export const readers: Readers = {
  studio: { getDraft, listDrafts } as unknown as Readers['studio'],
  publish: { validApproval, getDraft, listDrafts } as unknown as Readers['publish'],
};

type HomeView = z.infer<typeof Home>;
const COLLECT: Record<(typeof modules)[number], (tx: Tx, c: collect.Ctx) => Promise<collect.Collected>> = {
  publish: collect.publish, approve: collect.approve, studio: collect.studio, plan: collect.plan, research: collect.research, brand: collect.brand,
};
const PATH = { publish: 'publish', approve: 'approve', studio: 'studio', plan: 'plan', research: 'research', brand: 'brand' } as const;
const PREFIX = { brand: 'brand_', research: 'research_', plan: 'plan_', studio: 'studio_' } as const;

const scaled = (d: string, places: number) => {
  const [w, f = ''] = d.split('.');
  return BigInt(w! + f.padEnd(places, '0').slice(0, places));
};
const fixed = (v: bigint, places: number) => {
  const s = v.toString().padStart(places + 1, '0');
  return `${s.slice(0, -places)}.${s.slice(-places)}`;
};

async function costs(brandId: string): Promise<HomeView['costs']> {
  const c = await withBrand(brandId, (tx) => brandCosts(tx, brandId));
  const sum = (prefix: string) => {
    const rows = c.runs.filter((r) => r.runType.startsWith(prefix));
    return { usd: fixed(rows.reduce((t, r) => t + scaled(r.cost.usd, 4), 0n), 4), npr: fixed(rows.reduce((t, r) => t + scaled(r.cost.npr, 2), 0n), 2) };
  };
  return { month: c.month, total: c.total, byModule: (Object.keys(PREFIX) as (keyof typeof PREFIX)[]).map((module) => ({ module, cost: sum(PREFIX[module]) })) };
}

/** Throws NotFoundError (404) for a brand outside the tenant. A module that fails is named in `partial` and its items are left out. */
export async function home(brandId: string, now = new Date()): Promise<HomeView> {
  const brand = await withBrand(brandId, (tx) => getBrand(tx, brandId));
  const ctx: collect.Ctx = { brandId, now, timezone: brand.timezone, today: todayIn(brand.timezone, now), readers };
  // One transaction per module: a failed statement aborts its transaction, and it must not take another module's reads down.
  const answers = await Promise.all(
    modules.map(async (m) => {
      try {
        return await withBrand(brandId, (tx) => COLLECT[m](tx, ctx));
      } catch (e) {
        console.error(`home: ${m} did not answer`, e);
        return null;
      }
    }),
  );
  const got = modules.map((m, i) => [m, answers[i]] as const);
  const upcoming = (got.find(([m]) => m === 'publish')?.[1]?.extra?.upcoming ?? []) as HomeView['upcoming'];
  const paused = (got.find(([m]) => m === 'approve')?.[1]?.extra?.paused ?? null) as HomeView['paused'];
  return {
    brand: { id: brand.id, name: brand.name, timezone: brand.timezone },
    now: now.toISOString(),
    items: rank(got.flatMap(([, a]) => a?.items ?? []), now),
    upcoming: upcoming.slice(0, 3),
    partial: got.filter(([, a]) => !a).map(([m]) => m),
    paused,
    modules: got.map(([module, a]) => ({ module, status: a?.status ?? null, href: `/app/b/${brandId}/${PATH[module]}` })),
    costs: await costs(brandId).catch((e) => (console.error('home: costs unreadable', e), null)),
  };
}
