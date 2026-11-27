import { describe, expect, it } from 'vitest';
import { F1, F2 } from '../../../test/fixtures/plan/facts.ts';
import { checkBalance, normalizeIdea, type PlanItem, type Violation } from './balance.ts';
import type { PlanSettings } from './settings.ts';

let n = 0;
const item = (o: Partial<PlanItem> = {}): PlanItem => ({
  id: `i${++n}`, tenantId: 't', brandId: 'b', weekPlanId: 'w', day: '2026-11-29', channel: 'facebook', format: 'image', pillar: 'product',
  funnel: 'unaware', intent: 'teach', segmentId: null, campaignId: null, idea: `Idea ${n}`, cta: 'Buy', factIds: [], position: 0, origin: 'model',
  createdAt: new Date(), ...o,
});
const settings: PlanSettings = { channels: [], pillars: [], weekStarts: 0 };
const run = (items: PlanItem[], o: Partial<{ settings: PlanSettings; recentIdeas: string[] }> = {}) =>
  checkBalance({ items, settings: o.settings ?? settings, factIds: new Set([F1]), recentIdeas: o.recentIdeas ?? [] });
const rule = (vs: Violation[], r: Violation['rule']) => vs.filter((v) => v.rule === r);
const days = ['2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03'];

describe('checkBalance', () => {
  it('same_day_channel (blocking): two items on one channel one day; not on different days or channels', () => {
    const a = item(); const b = item();
    expect(rule(run([a, b]), 'same_day_channel')).toEqual([expect.objectContaining({ blocking: true, itemIds: [a.id, b.id] })]);
    expect(rule(run([a, item({ day: '2026-11-30' }), item({ channel: 'x' })]), 'same_day_channel')).toEqual([]);
  });

  it('incomplete (blocking): a missing idea, cta, pillar, funnel or format; not a complete item', () => {
    for (const miss of [{ idea: ' ' }, { cta: '' }, { pillar: null }, { funnel: null }, { format: null }])
      expect(rule(run([item(miss)]), 'incomplete')).toEqual([expect.objectContaining({ blocking: true })]);
    expect(rule(run([item()]), 'incomplete')).toEqual([]);
  });

  it('duplicate_idea (blocking): same idea after case, spacing and punctuation; not different ideas', () => {
    const a = item({ idea: 'Dashain  sale!' }); const b = item({ idea: 'dashain sale', day: '2026-11-30' });
    expect(rule(run([a, b]), 'duplicate_idea')).toEqual([expect.objectContaining({ blocking: true, itemIds: [a.id, b.id] })]);
    expect(rule(run([item({ idea: 'Dashain sale' }), item({ idea: 'Tihar sale', day: '2026-11-30' })]), 'duplicate_idea')).toEqual([]);
  });

  it('duplicate_idea does not merge different Nepali ideas, nor treat 5.0 and 50 alike', () => {
    expect(rule(run([item({ idea: 'दशैं छुट' }), item({ idea: 'तिहार छुट', day: '2026-11-30' })]), 'duplicate_idea')).toEqual([]);
    expect(rule(run([item({ idea: 'दशैं छुट।' }), item({ idea: 'दशैं  छुट', day: '2026-11-30' })]), 'duplicate_idea')).toHaveLength(1);
    expect(normalizeIdea('Save 5.0')).not.toBe(normalizeIdea('Save 50'));
  });

  it('duplicate_idea and incomplete see through invisible characters and full-width letters', () => {
    for (const idea of ['Shawl​ story', 'Shawl­ story', 'Ｓｈａｗｌ story'])
      expect(rule(run([item({ idea: 'Shawl story' }), item({ idea, day: '2026-11-30' })]), 'duplicate_idea')).toHaveLength(1);
    expect(rule(run([item({ idea: '​' })]), 'incomplete')).toHaveLength(1);
    expect(rule(run([item({ cta: '​' })]), 'incomplete')).toHaveLength(1);
  });

  it('duplicate_idea sees through tricks fixed in Approve and Studio: look-alike letters, accents, controls, other digits', () => {
    for (const idea of ['Ѕhawl story', 'Shawl\u0301 story', 'Sha\u0007wl story', 'Shawl story ५'])
      expect([idea, rule(run([item({ idea: idea.endsWith('५') ? 'Shawl story 5' : 'Shawl story' }), item({ idea, day: '2026-11-30' })]), 'duplicate_idea').length]).toEqual([idea, 1]);
  });

  it('unknown_fact (blocking): a cited fact that is not approved; not an approved one', () => {
    expect(rule(run([item({ factIds: [F1, F2] })]), 'unknown_fact')).toEqual([expect.objectContaining({ blocking: true })]);
    expect(rule(run([item({ factIds: [F1] })]), 'unknown_fact')).toEqual([]);
  });

  it('channel_count (not blocking): more or fewer items than posts per week; not when equal', () => {
    const s: PlanSettings = { ...settings, channels: [{ channel: 'facebook', postsPerWeek: 2 }, { channel: 'x', postsPerWeek: 1 }] };
    const v = rule(run([item(), item({ day: '2026-11-30' }), item({ channel: 'x' })], { settings: s }), 'channel_count');
    expect(v).toEqual([]);
    const few = rule(run([item()], { settings: s }), 'channel_count');
    expect(few.map((x) => x.blocking)).toEqual([false, false]); // facebook has 1 of 2, x has 0 of 1
    expect(rule(run([item({ channel: 'email' })], { settings: s }), 'channel_count').some((x) => x.message.includes('not in settings'))).toBe(true);
  });

  it('pillar_share (not blocking): three of five on one pillar; not two of five', () => {
    const mk = (pillars: string[]) => pillars.map((p, i) => item({ pillar: p as never, day: days[i]!, idea: `idea ${n}${i}` }));
    expect(rule(run(mk(['product', 'product', 'product', 'faq', 'proof'])), 'pillar_share')).toEqual([expect.objectContaining({ blocking: false })]);
    expect(rule(run(mk(['product', 'product', 'faq', 'proof', 'culture'])), 'pillar_share')).toEqual([]);
    expect(rule(run(mk(['product', 'product', 'product', 'faq'])), 'pillar_share')).toEqual([]); // under five items
  });

  it('format_variety (not blocking): four items all one format; not a mix, not three', () => {
    const mk = (formats: string[]) => formats.map((f, i) => item({ format: f as never, day: days[i]!, pillar: i % 2 ? 'faq' : 'product' }));
    expect(rule(run(mk(['image', 'image', 'image', 'image'])), 'format_variety')).toEqual([expect.objectContaining({ blocking: false })]);
    expect(rule(run(mk(['image', 'image', 'image', 'text'])), 'format_variety')).toEqual([]);
    expect(rule(run(mk(['image', 'image', 'image'])), 'format_variety')).toEqual([]);
  });

  it('repeat_idea (not blocking): an idea of the last four weeks; not a new one', () => {
    expect(rule(run([item({ idea: 'Spring SALE' })], { recentIdeas: ['spring sale.'] }), 'repeat_idea')).toEqual([expect.objectContaining({ blocking: false })]);
    expect(rule(run([item({ idea: 'Autumn sale' })], { recentIdeas: ['spring sale'] }), 'repeat_idea')).toEqual([]);
  });

  it('lists blocking violations first', () => {
    const v = run([item({ cta: '' }), item({ channel: 'email' })], { settings: { ...settings, channels: [{ channel: 'facebook', postsPerWeek: 3 }] } });
    expect(v[0]!.blocking).toBe(true);
    expect(v.at(-1)!.blocking).toBe(false);
  });
});
