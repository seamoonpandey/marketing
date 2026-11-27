import { describe, expect, it } from 'vitest';
import { payloadHash, payloadOf, type Payload } from './hash.ts';
import { riskOf } from './risk.ts';
import { approvalState, expiryOf, type Approval } from './state.ts';
import type { ReadyDraft } from './studio.ts';

const ID = '0196f3c2-0000-7000-8000-0000000000d1';
const F1 = '0196f3c2-0000-7000-8000-000000000001';
const A1 = '0196f3c2-0000-7000-8000-0000000000a1';
const NOW = new Date('2026-11-27T06:00:00Z');
const DAY = 86_400_000;

const content = (caption = 'Warm pashmina shawls, woven in Kathmandu.') => ({
  copies: [{ language: 'en', sentences: [{ text: caption, claim: false, factIds: [] }], hashtags: ['pashmina'], cta: 'Visit us' }],
  slides: [{ headline: 'Winter is here' }], scenes: [], template: 'headline', ratios: ['1:1'],
});
const payload = (over: Partial<Payload> = {}): Payload => ({
  objectType: 'studio_draft', objectId: ID, version: 3, channel: 'facebook', day: '2026-11-29', kind: 'static',
  content: content(), renders: [{ ratio: '1:1', sha256: 'f'.repeat(64) }, { ratio: '4:5', sha256: 'e'.repeat(64) }], ...over,
});
const draft = (over: Partial<ReadyDraft> = {}): ReadyDraft => ({
  id: ID, planItemId: F1, kind: 'static', status: 'ready', currentVersion: 3, readyVersion: 3, channel: 'facebook', day: '2026-11-29',
  pillar: null, campaignId: null, content: content(), leftOut: [], findings: [],
  renders: [{ ratio: '1:1', key: 'k1.png', width: 1080, height: 1080, overflow: false, sha256: 'f'.repeat(64) }],
  factIds: [F1], assetIds: [A1], ...over,
});
const approval = (over: Partial<Approval> = {}): Approval => ({
  id: 'x', tenantId: 't', brandId: 'b', objectType: 'studio_draft', objectId: ID, objectVersion: 3, seq: 1, payloadHash: payloadHash(payloadOf(draft())!),
  decision: 'approved', reason: null, risk: 'low', reviewNote: null, decidedBy: 'operator', decidedAt: NOW,
  expiresAt: new Date(NOW.getTime() + 14 * DAY), bulkId: null, createdAt: NOW, ...over,
});
const state = (over: Partial<Parameters<typeof approvalState>[0]> = {}) =>
  approvalState({ latest: approval(), draft: draft(), now: NOW, paused: false, approvedFactIds: new Set([F1]), assetsWithRights: new Set([A1]), ...over });

describe('payloadHash', () => {
  it('(review focus 3) hashes payloads equal but for key order the same, at every depth', () => {
    const p = payload();
    const shuffled = {
      renders: p.renders.map((r) => ({ sha256: r.sha256, ratio: r.ratio })), kind: p.kind, day: p.day, channel: p.channel, version: p.version,
      objectId: p.objectId, objectType: p.objectType,
      content: { ratios: ['1:1'], template: 'headline', scenes: [], slides: [{ headline: 'Winter is here' }], copies: [{ cta: 'Visit us', hashtags: ['pashmina'], sentences: [{ factIds: [], claim: false, text: 'Warm pashmina shawls, woven in Kathmandu.' }], language: 'en' }] },
    } as Payload;
    expect(payloadHash(shuffled)).toBe(payloadHash(p));
    expect(payloadHash(p)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when one character of the caption, the day, the channel, the version or one render checksum changes', () => {
    const h = payloadHash(payload());
    const changed = [
      payload({ content: content('Warm pashmina shawls, woven in Kathmandu!') }),
      payload({ day: '2026-11-30' }),
      payload({ channel: 'instagram' }),
      payload({ version: 4 }),
      payload({ renders: [{ ratio: '1:1', sha256: 'f'.repeat(64) }, { ratio: '4:5', sha256: `${'e'.repeat(63)}d` }] }),
      // Swapping two files changes what goes out in which place.
      payload({ renders: [{ ratio: '4:5', sha256: 'e'.repeat(64) }, { ratio: '1:1', sha256: 'f'.repeat(64) }] }),
      // A Unicode difference that looks the same is still a different payload.
      payload({ content: content('Warm pashmina shawls, woven in Kathmandu.​') }),
    ];
    for (const p of changed) expect(payloadHash(p)).not.toBe(h);
  });

  it('changes when the same files move to other slide positions', () => {
    const r = (c: string, index: number) => ({ ratio: '1:1', key: `${c}.png`, width: 1080, height: 1080, overflow: false, sha256: c.repeat(64), index, type: 'image' as const });
    const h = (renders: ReadyDraft['renders']) => payloadHash(payloadOf(draft({ kind: 'carousel', renders }))!);
    // The preview shows, and a publisher sends, slides by index: these two go out in opposite orders.
    expect(h([r('a', 1), r('b', 0)])).not.toBe(h([r('a', 0), r('b', 1)]));
  });

  it('(review focus 2) hashes a draft with no renders, the same twice', () => {
    const p = payloadOf(draft({ kind: 'post', renders: [] }))!;
    expect(p.renders).toEqual([]);
    expect(payloadHash(p)).toMatch(/^[0-9a-f]{64}$/);
    expect(payloadHash(payloadOf(draft({ kind: 'post', renders: [] }))!)).toBe(payloadHash(p));
  });

  it('payloadOf is null unless the draft is ready at its current version and every file has a checksum', () => {
    expect(payloadOf(draft())).toMatchObject({ objectId: ID, version: 3, renders: [{ ratio: '1:1', sha256: 'f'.repeat(64) }] });
    expect(payloadOf(draft({ status: 'draft' }))).toBeNull();
    expect(payloadOf(draft({ readyVersion: 2 }))).toBeNull();
    expect(payloadOf(draft({ readyVersion: null }))).toBeNull();
    expect(payloadOf(draft({ renders: [{ ratio: '1:1', key: 'k', width: 1, height: 1, overflow: false, sha256: '' }] }))).toBeNull();
  });
});

describe('riskOf', () => {
  const r = (text: string, o: { pillar?: string | null; industry?: string | null } = {}) => riskOf({ text, pillar: o.pillar ?? null, industry: o.industry ?? null });

  it('is high for a regulated industry and for promise words', () => {
    expect(r('Fresh stock this week', { industry: 'Pharmacy' }).risk).toBe('high');
    expect(r('Fresh stock', { industry: 'Healthcare clinic' }).risk).toBe('high');
    expect(r('Fresh stock', { industry: 'Alcoholic beverages' }).risk).toBe('high');
    expect(r('Results Guaranteed.').risk).toBe('high');
    expect(r('We guarantee it').risk).toBe('high');
    expect(r('Herbal cure for colds').risk).toBe('high');
    expect(r('A risk-free trial').risk).toBe('high');
    const high = r('Guaranteed — the best price: Rs 4,500', { industry: 'Pharmacy', pillar: 'offer' });
    expect(high.risk).toBe('high');
    expect(high.reasons.join(' | ')).toMatch(/Pharmacy.*Guaranteed/);
  });

  it('cannot be slipped past with case, width, invisible characters, odd spaces or dashes', () => {
    for (const t of ['GUARANTEED', 'ＧＵＡＲＡＮＴＥＥＤ', 'guaran​teed', 'gu­aranteed', 'risk‑free', 'risk free', 'RISK – FREE']) expect(r(t).risk, t).toBe('high');
    for (const t of ['better than the rest', 'better\n than', 'No.1 in Thamel', '#1 shawl']) expect(r(t).risk, t).toBe('medium');
  });

  it('cannot be slipped past with Cyrillic or Greek letters that look like Latin ones', () => {
    // а, С, і, е, Р are Cyrillic; Α is Greek.
    for (const t of ['Results guаranteed', 'Сure for colds', 'A rіsk-free trial', 'GUΑRANTEED']) expect(r(t).risk, t).toBe('high');
    expect(r('Fresh stock', { industry: 'Рharmacy' }).risk).toBe('high');
    expect(r('thе bеst shawl').risk).toBe('medium');
  });

  it('is medium for a price, a percentage, a comparison word or a comparison or offer pillar', () => {
    for (const t of ['Only Rs 4,500', 'Only Rs.4500', 'NPR 4500 only', 'Only NRs 4,500', 'NRs.4500', 'ने.रु. ४५००', '₨ 4500', 'रु ४५०० मात्र', '१५% छुट', '20 % off', 'the best shawl', 'cheapest in town', 'lowest price', 'better than mass-made', 'Nepal’s #1 shawl', 'No. 1 in Thamel'])
      expect(r(t).risk, t).toBe('medium');
    expect(r('Plain copy', { pillar: 'offer' }).risk).toBe('medium');
    expect(r('Plain copy', { pillar: 'comparison' }).risk).toBe('medium');
    expect(r('Only Rs 4,500').reasons).toEqual(['Price "Rs 4,500"']);
    expect(r('१५% छुट').reasons).toEqual(['Percentage "१५%"']);
  });

  it('is low for plain copy, and does not match inside other words', () => {
    expect(r('Warm shawls woven in Kathmandu', { pillar: 'product', industry: 'Textiles' })).toEqual({ risk: 'low', reasons: [] });
    for (const t of ['We are guaranteeing nothing', 'They bestow warmth', 'Open 9 to 5 hours', 'Secure checkout', 'गुरु ५ जना', 'Room 101 is free']) expect(r(t).risk, t).toBe('low');
  });
});

describe('approvalState', () => {
  it('is waiting with no decision, or with a decision for an older version of a ready draft', () => {
    expect(state({ latest: null })).toEqual({ state: 'waiting' });
    expect(state({ latest: approval({ objectVersion: 2 }), draft: draft({ currentVersion: 3, readyVersion: 3 }) })).toEqual({ state: 'waiting' });
    expect(state({ latest: approval({ objectVersion: 2, decision: 'rejected', reason: 'no' }) })).toEqual({ state: 'waiting' });
  });

  it('is rejected for a rejection of the current version, even if it would otherwise be valid', () => {
    expect(state({ latest: approval({ decision: 'rejected', reason: 'Wrong photo', expiresAt: null }) })).toEqual({ state: 'rejected', reason: 'Wrong photo' });
  });

  it('is invalid when the hash differs at the same version, the draft is gone or not ready, a fact is not approved or an asset lost its rights', () => {
    expect(state({ latest: approval({ payloadHash: '0'.repeat(64) }) }).state).toBe('invalid');
    expect(state({ draft: null }).state).toBe('invalid');
    expect(state({ draft: draft({ status: 'draft' }) }).state).toBe('invalid');
    // Edited after approval: a new version that is not ready yet.
    expect(state({ draft: draft({ status: 'draft', currentVersion: 4, readyVersion: null }) }).state).toBe('invalid');
    expect(state({ approvedFactIds: new Set() }).state).toBe('invalid');
    expect(state({ assetsWithRights: new Set() }).state).toBe('invalid');
    expect(state({ draft: draft({ findings: [{ check: 'prohibited_word', blocking: true, where: 'caption en', message: 'Uses "miracle"' }] }) }).state).toBe('invalid');
    expect(state({ draft: draft({ findings: [{ check: 'many_hashtags', blocking: false, where: 'caption en', message: 'Many hashtags' }] }) }).state).toBe('approved');
    // invalid wins over expired and paused
    expect(state({ draft: null, paused: true, now: new Date(NOW.getTime() + 30 * DAY) }).state).toBe('invalid');
  });

  it('is expired one second after the expiry, and at it', () => {
    const latest = approval({ expiresAt: new Date(NOW.getTime() - 1000) });
    expect(state({ latest }).state).toBe('expired');
    expect(state({ latest: approval({ expiresAt: NOW }) }).state).toBe('expired');
    expect(state({ latest: approval({ expiresAt: null }) }).state).toBe('expired');
    expect(state({ latest, paused: true }).state).toBe('expired');
  });

  it('is paused when paused and otherwise valid, and approved otherwise', () => {
    expect(state({ paused: true }).state).toBe('paused');
    expect(state()).toEqual({ state: 'approved' });
  });
});

describe('expiryOf', () => {
  const at = (days: number) => new Date(NOW.getTime() + days * DAY);
  it('returns the earliest of the validity days, fact expiries and rights expiries, ignoring nulls', () => {
    expect(expiryOf({ decidedAt: NOW, maxAgeDays: 14, factExpiries: [], rightsExpiries: [] })).toEqual(at(14));
    expect(expiryOf({ decidedAt: NOW, maxAgeDays: 14, factExpiries: [null, at(5), at(9)], rightsExpiries: [null] })).toEqual(at(5));
    expect(expiryOf({ decidedAt: NOW, maxAgeDays: 14, factExpiries: [at(5)], rightsExpiries: [at(2), null] })).toEqual(at(2));
    expect(expiryOf({ decidedAt: NOW, maxAgeDays: 1, factExpiries: [at(5)], rightsExpiries: [at(2)] })).toEqual(at(1));
  });
});
