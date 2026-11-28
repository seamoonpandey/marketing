import { describe, expect, it } from 'vitest';
import type { EvidenceItem } from './opportunity-evidence.ts';
import { keepOpportunities, type Proposal } from './opportunities.ts';

const items: EvidenceItem[] = [
  { ref: 'e1', type: 'observation', id: 'o1', label: 'Momo Hut', detail: 'Lunch price dropped', quote: 'Lunch set Rs 350', sourceId: 's1' },
  { ref: 'e2', type: 'candidate', id: 'c1', label: 'Bhojan Ghar', detail: 'Sells to: offices', quote: 'Office lunch delivered by 12:30', sourceId: 's2' },
  { ref: 'e3', type: 'fact', id: 'f1', label: 'Your brand', detail: 'delivery area: Kathmandu' },
];
const p = (o: Partial<Proposal> = {}): Proposal => ({
  kind: 'gap', title: 'Offer office lunch', hypothesis: 'h', suggestedAction: 'a', whyItMatters: 'w', evidence: ['e2'],
  impact: 'medium', effort: 'medium', confidence: 'medium', ...o,
});

describe('keepOpportunities', () => {
  it('orders by impact, then confidence, then effort', () => {
    const { kept } = keepOpportunities([
      p({ title: 'A', impact: 'low', confidence: 'high', effort: 'low' }),
      p({ title: 'B', impact: 'high', confidence: 'low', effort: 'high' }),
      p({ title: 'C', impact: 'high', confidence: 'high', effort: 'high' }),
      p({ title: 'D', impact: 'high', confidence: 'high', effort: 'low' }),
    ], items, []);
    expect(kept.map((k) => k.title)).toEqual(['D', 'C', 'B', 'A']);
  });

  it('cuts a 300-character title to 120 and removes control characters', () => {
    const { kept } = keepOpportunities([p({ title: `\u0007${'x'.repeat(300)}`, hypothesis: `h\u0000${'y'.repeat(700)}` })], items, []);
    expect(kept[0]!.title).toBe('x'.repeat(120));
    expect(kept[0]!.hypothesis).toBe(`h${'y'.repeat(599)}`);
  });

  it('removes unknown references, reads a reference as written, and needs competitor evidence', () => {
    const { kept, dropped } = keepOpportunities([
      p({ title: 'Unknown only', evidence: ['e9'] }),
      p({ title: 'Facts only', evidence: ['e3'] }),
      p({ title: 'Mixed', evidence: ['e9', ' E2 ', 'e1', 'e2'] }),
    ], items, []);
    expect(dropped).toBe(2);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.evidence).toEqual([
      { type: 'candidate', id: 'c1', label: 'Bhojan Ghar', detail: 'Sells to: offices', quote: 'Office lunch delivered by 12:30', sourceId: 's2' },
      { type: 'observation', id: 'o1', label: 'Momo Hut', detail: 'Lunch price dropped', quote: 'Lunch set Rs 350', sourceId: 's1' },
    ]);
    expect(kept[0]!.observationIds).toEqual(['o1']);
  });

  it('drops a second proposal with the same folded title in one answer', () => {
    const { kept, dropped } = keepOpportunities([p({ title: 'Offer office lunch' }), p({ title: 'OFFER​ office  lunch' })], items, []);
    expect([kept.length, dropped]).toEqual([1, 1]);
  });
});
