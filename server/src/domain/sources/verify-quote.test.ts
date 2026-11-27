import { describe, expect, it } from 'vitest';
import { verifyQuote } from './verify-quote.ts';

const source = `Himal Tea House — “hand-rolled”   green tea,
since 1998. हिमाल क़लम पश्मिना`;

describe('verifyQuote', () => {
  it('matches across whitespace, curly quotes and dashes', () => {
    expect(verifyQuote(source, 'Himal Tea House - "hand-rolled" green tea, since 1998.')).toBe(true);
  });

  it('matches composed and decomposed Devanagari', () => {
    // क़ (U+0958) in the source, क + nukta (U+0915 U+093C) in the quote
    expect(verifyQuote(source, 'हिमाल क़लम पश्मिना')).toBe(true);
  });

  it('is false for an absent quote and for a quote under 10 characters', () => {
    expect(verifyQuote(source, 'machine-rolled green tea')).toBe(false);
    expect(verifyQuote(source, 'Himal Tea')).toBe(false); // 9 characters
  });

  it('counts only visible characters toward the 10-character minimum (the review-note padding trick fixed in Approve)', () => {
    const padded = `Rs 5${'\u200b'.repeat(8)}`;
    expect(verifyQuote(`Price ${padded} only`, padded)).toBe(false);
  });

  it('is false for a quote over 300 characters', () => {
    expect(verifyQuote('a'.repeat(400), 'a'.repeat(301))).toBe(false);
  });
});
