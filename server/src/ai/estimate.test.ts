import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { estimateTokens } from './estimate.ts';

describe('estimateTokens', () => {
  it('counts 1 token per 4 characters, 2,500 per PDF page and 1,600 per image', () => {
    const pdf = new Uint8Array(readFileSync(new URL('../../test/fixtures/base/files/text.pdf', import.meta.url)));
    expect(
      estimateTokens([
        { type: 'text', text: 'x'.repeat(4001) },
        { type: 'file', mediaType: 'application/pdf', data: pdf },
        { type: 'file', mediaType: 'image/png', data: new Uint8Array(10) },
      ]),
    ).toBe(1001 + 2500 + 1600);
  });
});
