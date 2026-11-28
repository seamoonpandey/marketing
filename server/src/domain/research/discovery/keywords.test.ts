import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../http/errors.ts';
import { cleanKeywords } from './keywords.ts';
import { KEYWORD_SYSTEM } from './prompts.ts';

describe('cleanKeywords', () => {
  it('trims, dedupes by folded text and keeps the owner order', () => {
    expect(cleanKeywords([' Momo Kathmandu ', 'momo  kathmandu', 'Frozen momo Nepal'])).toEqual(['Momo Kathmandu', 'Frozen momo Nepal']);
  });

  it('keeps Devanagari keywords as written and merges spacing variants', () => {
    expect(cleanKeywords(['मोमो काठमाडौं', ' मोमो  काठमाडौं '])).toEqual(['मोमो काठमाडौं']);
  });

  it('removes control characters and drops keywords left empty', () => {
    expect(cleanKeywords(['mo\u0000mo', '  ', '​'])).toEqual(['momo']);
  });

  it('refuses no keywords, more than 15, or one over 80 characters', () => {
    expect(() => cleanKeywords(['  ', ''])).toThrow(ValidationError);
    expect(() => cleanKeywords(Array.from({ length: 16 }, (_, i) => `momo ${i}`))).toThrow(ValidationError);
    expect(cleanKeywords(Array.from({ length: 15 }, (_, i) => `momo ${i}`))).toHaveLength(15);
    expect(() => cleanKeywords(['m'.repeat(81)])).toThrow(ValidationError);
    expect(cleanKeywords(['m'.repeat(80)])).toHaveLength(1);
  });
});

it('asks the model for at least two keywords without a place name', () => {
  expect(KEYWORD_SYSTEM).toMatch(/at least two (keywords|searches) without a place name/i);
  expect(KEYWORD_SYSTEM).toMatch(/untrusted data/i);
});

it('asks the model for the strongest searches first and to leave out what only this brand has', () => {
  expect(KEYWORD_SYSTEM).toMatch(/strongest first/i);
  expect(KEYWORD_SYSTEM).toMatch(/only this brand has/i);
});
