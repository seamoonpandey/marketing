import { describe, expect, it } from 'vitest';
import { estimateCost } from './index.ts';

describe('estimateCost', () => {
  it('prices Opus 5.5 at USD 4 in and 20 out per million tokens, in USD and NPR', () => {
    expect(estimateCost('anthropic:claude-opus-5-5', 1_000_000, 100_000)).toEqual({ usd: '6.0000', npr: '930.48' });
  });

  it('refuses an unknown model', () => {
    expect(() => estimateCost('nope', 1, 1)).toThrow();
  });
});
