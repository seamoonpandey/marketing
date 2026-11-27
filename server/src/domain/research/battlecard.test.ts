import { describe, expect, it } from 'vitest';
import type { ApprovedFact } from '../../contracts/common.ts';
import { buildBattlecard } from './battlecard.ts';

const fact = (id: string): ApprovedFact => ({
  id, section: 'products', subjectType: 'product', subjectId: null, subjectName: null, field: 'price', value: 4000,
  unit: 'NPR', language: 'en', sourceId: null, verifiedAt: '2026-11-01T00:00:00Z', expiresAt: null,
});
const draft = {
  differ: [{ text: 'Ours is cheaper', factIds: ['f-missing'] }, { text: 'Ours is handmade', factIds: ['f1', 'f-missing'] }],
  proof: [{ text: 'Rs 4,000' }],
  objections: [
    { text: 'They are cheaper', observationIds: ['o1'] },
    { text: 'They say hand-woven', profileQuote: 'Hand-woven pashmina shawls from the Himalaya' },
    { text: 'They are famous', observationIds: ['o-missing'] },
  ],
  responses: [{ text: 'Ask about quality', factIds: ['f1'] }],
};

describe('buildBattlecard', () => {
  it('moves a differ statement citing an unknown fact to leftOut', () => {
    const r = buildBattlecard({ draft, facts: [fact('f1')], observationIds: ['o1'], profileText: 'Hand-woven pashmina shawls from the Himalaya' });
    expect(r.body.differ).toEqual([{ text: 'Ours is handmade', factIds: ['f1'] }]);
    expect(r.leftOut).toContainEqual({ text: 'Ours is cheaper', reason: 'no approved fact' });
    expect(r.leftOut).toContainEqual({ text: 'Rs 4,000', reason: 'no approved fact' });
    expect(r.body.objections.map((s) => s.text)).toEqual(['They are cheaper', 'They say hand-woven']);
    expect(r.leftOut).toContainEqual({ text: 'They are famous', reason: 'no evidence' });
  });

  it('with no facts leaves differ, proof and responses empty and lists every statement', () => {
    const r = buildBattlecard({ draft, facts: [], observationIds: [], profileText: '' });
    expect([r.body.differ, r.body.proof, r.body.responses]).toEqual([[], [], []]);
    expect(r.leftOut).toHaveLength(2 + 1 + 3 + 1);
  });
});
