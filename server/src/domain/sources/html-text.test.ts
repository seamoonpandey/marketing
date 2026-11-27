import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { htmlText, htmlTitle } from './html-text.ts';

const nepali = readFileSync(new URL('../../../test/fixtures/base/site/nepali.html', import.meta.url), 'utf8');

describe('htmlText', () => {
  it('drops script, style and nav and keeps Devanagari intact', () => {
    const text = htmlText(nepali);
    expect(text).toContain('हिमाल पश्मिना');
    expect(text).toContain('हामी १९९८ देखि हातले बुनेको पश्मिना बनाउँछौं।');
    expect(text).toContain('Prices from NPR 4,500 & up.');
    expect(text).not.toContain('tracker');
    expect(text).not.toContain('color: red');
    expect(text).not.toContain('हाम्रो बारेमा');
  });

  it('reads the title', () => {
    expect(htmlTitle(nepali)).toBe('हिमाल पश्मिना');
  });
});
