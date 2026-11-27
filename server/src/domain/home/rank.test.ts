import { describe, expect, it } from 'vitest';
import { rank, type Item } from './rank.ts';

const it_ = (kind: string, module: Item['module'], urgency: Item['urgency'], due: string | null = null): Item => ({
  kind, module, urgency, due, title: kind, detail: '', count: null, href: '/',
});
const NOW = new Date('2026-11-28T06:00:00Z');
const order = (items: Item[]) => rank(items, NOW).map((i) => i.kind);

describe('rank', () => {
  const cases: [string, Item[], string[]][] = [
    ['urgency first', [it_('a', 'publish', 'later'), it_('b', 'brand', 'now'), it_('c', 'plan', 'soon'), it_('d', 'studio', 'today')], ['b', 'd', 'c', 'a']],
    ['the earlier due first inside one urgency', [it_('a', 'publish', 'soon', '2026-11-30T00:00:00Z'), it_('b', 'brand', 'soon', '2026-11-29T00:00:00Z')], ['b', 'a']],
    ['a due beats no due', [it_('a', 'publish', 'soon'), it_('b', 'brand', 'soon', '2026-12-31T00:00:00Z')], ['b', 'a']],
    ['an overdue item is first among its urgency', [it_('a', 'publish', 'now', '2026-11-28T09:00:00Z'), it_('b', 'brand', 'now', '2026-11-20T00:00:00Z')], ['b', 'a']],
    ['module order on equal due', [it_('a', 'brand', 'soon', '2026-11-29T00:00:00Z'), it_('b', 'research', 'soon', '2026-11-29T00:00:00Z'), it_('c', 'publish', 'soon', '2026-11-29T00:00:00Z')], ['c', 'b', 'a']],
    ['module order when neither has a due', [it_('a', 'brand', 'later'), it_('b', 'plan', 'later'), it_('c', 'approve', 'later'), it_('d', 'studio', 'later'), it_('e', 'research', 'later'), it_('f', 'publish', 'later')], ['f', 'c', 'd', 'b', 'e', 'a']],
    ['urgency beats an earlier due', [it_('a', 'publish', 'later', '2026-01-01T00:00:00Z'), it_('b', 'brand', 'now', '2026-12-01T00:00:00Z')], ['b', 'a']],
    ['full ties keep their order', [it_('a', 'plan', 'soon'), it_('b', 'plan', 'soon'), it_('c', 'plan', 'soon')], ['a', 'b', 'c']],
    ['an empty queue', [], []],
  ];
  it.each(cases)('%s', (_name, items, expected) => expect(order(items)).toEqual(expected));

  it('does not change its input', () => {
    const input = [it_('a', 'brand', 'later'), it_('b', 'publish', 'now')];
    rank(input, NOW);
    expect(input.map((i) => i.kind)).toEqual(['a', 'b']);
  });
});
