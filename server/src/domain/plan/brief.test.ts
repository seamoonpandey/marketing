import { describe, expect, it } from 'vitest';
import { F1, F2, facts } from '../../../test/fixtures/plan/facts.ts';
import { buildBrief, type BriefBody } from './brief.ts';
import { briefSections } from './enums.ts';

const empty = () => Object.fromEntries(briefSections.map((s) => [s, []])) as unknown as BriefBody;
const GHOST = '0196f3c2-0000-7000-8000-0000000000ff';

describe('buildBrief', () => {
  it('moves an offer_message statement citing an unknown fact to leftOut; keeps a creative statement with no fact id', () => {
    const draft = { ...empty(), offer_message: [{ text: 'Free shipping', factIds: [GHOST] }], creative: [{ text: 'A calm product video' }] };
    const { body, leftOut } = buildBrief({ draft, facts });
    expect(body.offer_message).toEqual([]);
    expect(leftOut).toEqual([{ section: 'offer_message', text: 'Free shipping', reason: 'no approved fact' }]);
    expect(body.creative).toEqual([{ text: 'A calm product video' }]);
  });

  it('keeps the known ids of a statement and strips the unknown ones', () => {
    const draft = { ...empty(), audience: [{ text: 'Gift buyers', factIds: [F1, GHOST, F1] }], risk: [{ text: 'Claims', factIds: [GHOST] }] };
    const { body, leftOut } = buildBrief({ draft, facts });
    expect(body.audience).toEqual([{ text: 'Gift buyers', factIds: [F1] }]);
    expect(body.risk).toEqual([{ text: 'Claims' }]); // risk needs no fact, so it stays, without the stray id
    expect(leftOut).toEqual([]);
  });

  it('with no facts leaves audience and offer_message empty and lists every statement', () => {
    const draft = { ...empty(), audience: [{ text: 'a', factIds: [F1] }], offer_message: [{ text: 'b', factIds: [F2] }, { text: 'c' }] };
    const { body, leftOut } = buildBrief({ draft, facts: [] });
    expect(body.audience).toEqual([]);
    expect(body.offer_message).toEqual([]);
    expect(leftOut.map((l) => l.text)).toEqual(['a', 'b', 'c']);
  });

  it('tolerates a missing section', () => {
    const { body } = buildBrief({ draft: { creative: [{ text: 'x' }] } as unknown as BriefBody, facts });
    expect(body.risk).toEqual([]);
    expect(body.creative).toHaveLength(1);
  });
});
