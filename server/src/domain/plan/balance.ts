import type { planItems } from '../../db/schema/plan.ts';
import { foldText } from '../../text/normalise.ts';
import type { PlanSettings } from './settings.ts';

export type PlanItem = typeof planItems.$inferSelect;
export type Violation = {
  rule: 'same_day_channel' | 'incomplete' | 'duplicate_idea' | 'unknown_fact' | 'channel_count' | 'pillar_share' | 'format_variety' | 'repeat_idea';
  blocking: boolean;
  itemIds: string[];
  message: string;
};

/**
 * The comparison form (foldText), with punctuation and symbols as spaces. Letters and each script's own
 * marks are kept, so two different Nepali ideas never normalise to the same (empty) string.
 */
export const normalizeIdea = (s: string): string => foldText(s).replace(/[\p{P}\p{S}]+/gu, ' ').replace(/\s+/g, ' ').trim();

const groupBy = <T>(xs: T[], key: (x: T) => string) => {
  const m = new Map<string, T[]>();
  for (const x of xs) m.set(key(x), [...(m.get(key(x)) ?? []), x]);
  return [...m.values()];
};
const ids = (xs: PlanItem[]) => xs.map((i) => i.id);

/** The eight balance rules (design section 3). Pure; the four blocking ones keep a week from approval. */
export function checkBalance(i: { items: PlanItem[]; settings: PlanSettings; factIds: Set<string>; recentIdeas: string[] }): Violation[] {
  const { items } = i;
  const out: Violation[] = [];
  const add = (rule: Violation['rule'], blocking: boolean, list: PlanItem[], message: string) => out.push({ rule, blocking, itemIds: ids(list), message });

  for (const g of groupBy(items, (x) => `${x.day}|${x.channel}`))
    if (g.length > 1) add('same_day_channel', true, g, `${g.length} items on ${g[0]!.channel} on ${g[0]!.day}`);

  for (const x of items) {
    const missing = [!normalizeIdea(x.idea) && 'idea', !normalizeIdea(x.cta) && 'call to action', !x.pillar && 'pillar', !x.funnel && 'funnel stage', !x.format && 'format'].filter(Boolean);
    if (missing.length) add('incomplete', true, [x], `Missing: ${missing.join(', ')}`);
  }

  for (const g of groupBy(items.filter((x) => normalizeIdea(x.idea)), (x) => normalizeIdea(x.idea)))
    if (g.length > 1) add('duplicate_idea', true, g, `${g.length} items have the same idea`);

  for (const x of items) {
    const unknown = x.factIds.filter((f) => !i.factIds.has(f));
    if (unknown.length) add('unknown_fact', true, [x], `Cites ${unknown.length} fact${unknown.length > 1 ? 's' : ''} that ${unknown.length > 1 ? 'are' : 'is'} not approved today`);
  }

  const planned = new Map(i.settings.channels.map((c) => [c.channel, c.postsPerWeek]));
  for (const ch of new Set([...planned.keys(), ...items.map((x) => x.channel)])) {
    const mine = items.filter((x) => x.channel === ch);
    const want = planned.get(ch) ?? 0;
    if (mine.length !== want)
      add('channel_count', false, mine, `${ch} has ${mine.length} item${mine.length === 1 ? '' : 's'}; settings ask for ${want}${planned.has(ch) ? '' : ' (not in settings)'}`);
  }

  if (items.length >= 5)
    for (const g of groupBy(items.filter((x) => x.pillar), (x) => x.pillar!))
      if (g.length / items.length > 0.4) add('pillar_share', false, g, `${g[0]!.pillar} is ${g.length} of ${items.length} items (over 40%)`);

  if (items.length >= 4 && items[0]!.format && items.every((x) => x.format === items[0]!.format))
    add('format_variety', false, items, `Every item is ${items[0]!.format}`);

  const recent = new Set(i.recentIdeas.map(normalizeIdea).filter(Boolean));
  for (const x of items) if (recent.has(normalizeIdea(x.idea))) add('repeat_idea', false, [x], 'This idea was used in the last four weeks');

  return out.sort((a, b) => Number(b.blocking) - Number(a.blocking));
}
