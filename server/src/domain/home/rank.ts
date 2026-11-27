import type { z } from '@hono/zod-openapi';
import type * as C from '../../contracts/home.ts';

export type Item = z.infer<typeof C.Item>;

const URGENCY = { now: 0, today: 1, soon: 2, later: 3 } as const;
const MODULE = { publish: 0, approve: 1, studio: 2, plan: 3, research: 4, brand: 5 } as const;

/**
 * The queue's order: urgency, then the earlier due (no due last), then publish, approve, studio, plan,
 * research, brand; items equal on all three keep their order. `now` is part of the contract but the rule
 * needs no clock: an overdue item already sorts first on its due.
 */
export function rank(items: Item[], _now: Date): Item[] {
  const at = (i: Item) => (i.due ? Date.parse(i.due) : Number.POSITIVE_INFINITY);
  // Infinity - Infinity is NaN, so compare instead of subtracting.
  const byDue = (a: Item, b: Item) => (at(a) < at(b) ? -1 : at(a) > at(b) ? 1 : 0);
  return items
    .map((item, n) => ({ item, n }))
    .sort((a, b) => URGENCY[a.item.urgency] - URGENCY[b.item.urgency] || byDue(a.item, b.item) || MODULE[a.item.module] - MODULE[b.item.module] || a.n - b.n)
    .map((e) => e.item);
}
