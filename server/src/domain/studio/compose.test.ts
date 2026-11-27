import { describe, expect, it } from 'vitest';
import { F1, F2, fact } from '../../../test/fixtures/plan/facts.ts';
import { composeCopy, kindFor } from './compose.ts';

describe('composeCopy', () => {
  it('leaves out a claim citing an unknown fact, keeps a non-claim, and joins only kept sentences in order', () => {
    const r = composeCopy({
      facts: [fact(F1)],
      sentences: [
        { text: 'Warm pashmina.', claim: true, factIds: [F1, F2] },
        { text: 'Lowest price in Kathmandu.', claim: true, factIds: [F2] },
        { text: 'Come and see.', claim: false },
        { text: 'Unproven.', claim: true },
      ],
    });
    expect(r.leftOut).toEqual([{ text: 'Lowest price in Kathmandu.', reason: 'no approved fact' }, { text: 'Unproven.', reason: 'no approved fact' }]);
    expect(r.sentences).toEqual([{ text: 'Warm pashmina.', claim: true, factIds: [F1] }, { text: 'Come and see.', claim: false, factIds: [] }]);
    expect(r.caption).toBe('Warm pashmina. Come and see.');
  });
});

describe('kindFor', () => {
  it('maps formats to kinds', () => {
    expect(['carousel', 'short_video', 'image', 'text', 'blog', null].map(kindFor)).toEqual(['carousel', 'video', 'static', 'post', 'post', 'post']);
  });
});
