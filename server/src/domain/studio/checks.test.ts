import { describe, expect, it } from 'vitest';
import { F1, F2, fact } from '../../../test/fixtures/plan/facts.ts';
import type { DraftContent, RenderRecord } from '../../db/schema/studio.ts';
import { checkDraft, containsWord, numbersIn, type Finding } from './checks.ts';

const kit = { colours: { primary: '#0f5257', text: '#141414', background: '#ffffff' } };
const content = (o: Partial<DraftContent['copies'][number]> = {}, rest: Partial<DraftContent> = {}): DraftContent => ({
  copies: [{ language: 'en', sentences: [{ text: 'Warm pashmina.', claim: true, factIds: [F1] }], hashtags: [], cta: 'Visit us', ...o }],
  slides: [], scenes: [], template: 'headline', ratios: ['1:1'], channel: 'instagram', ...rest,
});
const base = { kind: 'post' as const, channel: 'instagram', renders: [] as RenderRecord[], version: 1, facts: [fact(F1, 'price', 'NPR 4000, 15% off until 24 October')], prohibited: [] as string[], assetsWithRights: new Set<string>(), kit };
const run = (o: Partial<Parameters<typeof checkDraft>[0]> & { content?: DraftContent } = {}) => checkDraft({ ...base, content: content(), ...o });
const only = (f: Finding[], check: Finding['check']) => f.filter((x) => x.check === check);
const sent = (text: string, factIds = [F1]) => content({ sentences: [{ text, claim: true, factIds }] });
const render = (o: Partial<RenderRecord> = {}): RenderRecord => ({ ratio: '1:1', key: 'k', sha256: 'x', width: 1080, height: 1080, overflow: false, index: 0, type: 'image', ...o });

describe('checkDraft', () => {
  it('passes a clean post', () => expect(run()).toEqual([]));

  it('unverified_number (blocking): 15% and 24 pass when the fact has both, 24 fails when it has only 15', () => {
    expect(only(run({ content: sent('15% off until 24 October') }), 'unverified_number')).toEqual([]);
    const f = run({ content: sent('15% off until 24 October'), facts: [fact(F1, 'offer', '15% off')] });
    expect(only(f, 'unverified_number')).toMatchObject([{ blocking: true, message: expect.stringContaining('24') }]);
  });
  it('reads Devanagari digits as ASCII (review focus 5) and separators and decimals as one number', () => {
    expect(numbersIn('१५% छुट')).toEqual(['15']);
    expect(numbersIn('NPR १,५००.५० and ４０')).toEqual(['1500.5', '40']);
    expect(only(run({ content: sent('१५% छुट') }), 'unverified_number')).toEqual([]);
    expect(only(run({ content: sent('९०% छुट') }), 'unverified_number')).toHaveLength(1);
  });
  it('a number on a slide or in a scene is checked too', () => {
    const slide = content({}, { slides: [{ headline: 'Only 77 left' }] });
    expect(only(run({ content: slide }), 'unverified_number')).toMatchObject([{ where: 'slide 1' }]);
    const scene = content({}, { scenes: [{ onScreenText: 'ok', voiceover: 'save 88', shot: 's', seconds: 2 }] });
    expect(only(run({ content: scene }), 'unverified_number')).toMatchObject([{ where: 'scene 1' }]);
  });
  it('prohibited_word (blocking): whole words, any case, not hidden by zero-width or width tricks', () => {
    expect(only(run({ content: sent('We GUARANTEE it'), prohibited: ['guarantee'] }), 'prohibited_word')).toMatchObject([{ blocking: true }]);
    expect(only(run({ content: sent('gua​rantee it'), prohibited: ['guarantee'] }), 'prohibited_word')).toHaveLength(1);
    expect(only(run({ content: sent('ｇｕａｒａｎｔｅｅ it'), prohibited: ['guarantee'] }), 'prohibited_word')).toHaveLength(1);
    expect(only(run({ content: sent('guaranteed'), prohibited: ['guarantee'] }), 'prohibited_word')).toEqual([]);
    expect(containsWord('best  price', 'Best Price')).toBe(true);
  });
  it('too_long (blocking): x allows 280 characters, not 281; email has no limit', () => {
    const s = (n: number) => content({ sentences: [{ text: 'a'.repeat(n), claim: false, factIds: [] }] });
    expect(only(run({ channel: 'x', content: s(281) }), 'too_long')).toMatchObject([{ blocking: true }]);
    expect(only(run({ channel: 'x', content: s(280) }), 'too_long')).toEqual([]);
    expect(only(run({ channel: 'email', content: s(9000) }), 'too_long')).toEqual([]);
  });
  it('missing_cta (blocking)', () => {
    expect(only(run({ content: content({ cta: '  ' }) }), 'missing_cta')).toMatchObject([{ blocking: true }]);
    expect(only(run(), 'missing_cta')).toEqual([]);
  });
  it('expired_fact (blocking): a cited fact that is not in today\'s list or has passed its expiry', () => {
    expect(only(run({ facts: [] }), 'expired_fact')).toMatchObject([{ blocking: true }]);
    const old = { ...fact(F1, 'price', 'NPR 4000, 15% off until 24 October'), expiresAt: '2020-01-01T00:00:00Z' };
    expect(only(run({ facts: [old] }), 'expired_fact')).toHaveLength(1);
    expect(only(run({ facts: [fact(F1, 'price', '1'), fact(F2)] }), 'expired_fact')).toEqual([]);
  });
  it('no_rights (blocking)', () => {
    const c = content({}, { slides: [{ headline: 'Hi', photoAssetId: 'asset-1' }] });
    expect(only(run({ kind: 'static', content: c }), 'no_rights')).toMatchObject([{ blocking: true }]);
    expect(only(run({ kind: 'static', content: c, assetsWithRights: new Set(['asset-1']) }), 'no_rights')).toEqual([]);
  });
  it('text_overflow (blocking) and not_rendered (blocking)', () => {
    const c = content({}, { slides: [{ headline: 'Hi' }, { headline: 'There' }] });
    const full = [0, 1].map((index) => render({ index }));
    expect(only(run({ kind: 'carousel', content: c, renders: full }), 'not_rendered')).toEqual([]);
    expect(only(run({ kind: 'carousel', content: c, renders: full }), 'text_overflow')).toEqual([]);
    expect(only(run({ kind: 'carousel', content: c, renders: [render({ index: 0, overflow: true }), render({ index: 1 })] }), 'text_overflow')).toMatchObject([{ blocking: true }]);
    expect(only(run({ kind: 'carousel', content: c, renders: [] }), 'not_rendered')).toMatchObject([{ blocking: true }]);
    expect(only(run({ kind: 'carousel', content: c, renders: [render({ index: 0 })] }), 'not_rendered')).toHaveLength(1);
    expect(only(run({ kind: 'post' }), 'not_rendered')).toEqual([]);
  });
  it('a video needs its mp4 as well as its cards', () => {
    const c = content({}, { scenes: [{ onScreenText: 'Hi', voiceover: '', shot: '', seconds: 2 }] });
    expect(only(run({ kind: 'video', content: c, renders: [render()] }), 'not_rendered')).toHaveLength(1);
    expect(only(run({ kind: 'video', content: c, renders: [render(), render({ type: 'video' })] }), 'not_rendered')).toEqual([]);
  });
  it('low_contrast and many_hashtags do not block', () => {
    expect(only(run({ kit: { colours: { primary: '#000', text: '#777777', background: '#888888' } } }), 'low_contrast')).toMatchObject([{ blocking: false }]);
    expect(only(run(), 'low_contrast')).toEqual([]);
    const tags = (n: number) => content({ hashtags: Array.from({ length: n }, (_, i) => `t${String.fromCharCode(97 + i)}`) });
    expect(only(run({ content: tags(11) }), 'many_hashtags')).toMatchObject([{ blocking: false }]);
    expect(only(run({ content: tags(10) }), 'many_hashtags')).toEqual([]);
  });
});
