import { describe, expect, it } from 'vitest';
import { MAX_CANDIDATES } from './match.ts';
import { GROUP_MAX_OUTPUT, GROUP_SYSTEM } from './prompts.ts';

describe('the group call', () => {
  it('asks for no more businesses than its output cap holds, and for more than are kept', () => {
    // 15 keywords give up to 450 results; listing every business in them would run past the cap and void the answer.
    const n = Number(GROUP_SYSTEM.match(/at most (\d+) businesses/)?.[1]);
    const business = {
      name: 'Himalayan Momo House and Restaurant', site: 'https://himalayanmomohouse.com.np/', placeCid: '12345678901234567890', rank: 60,
      resultIds: Array.from({ length: 10 }, (_, i) => `r${440 + i}`), socials: ['https://www.facebook.com/himalayanmomohouse'],
    };
    // About 3 characters a token for JSON of links and IDs.
    expect(Math.ceil(JSON.stringify({ businesses: Array(n).fill(business) }).length / 3)).toBeLessThanOrEqual(GROUP_MAX_OUTPUT);
    expect(n).toBeGreaterThan(MAX_CANDIDATES);
  });
});
