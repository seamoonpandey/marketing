import { describe, expect, it } from 'vitest';
import { diffText } from './diff.ts';

describe('diffText', () => {
  it('ignores whitespace-only differences', () => {
    expect(diffText('Pashmina shawl Rs 5,000\n\nHandmade in Nepal', 'Pashmina   shawl Rs 5,000\nHandmade in  Nepal').changed).toBe(false);
  });
  it('reports a price change as one block', () => {
    const r = diffText('Pashmina shawl Rs 5,000', 'Pashmina shawl Rs 4,500');
    expect(r).toEqual({ changed: true, blocks: [{ before: 'Pashmina shawl Rs 5,000', after: 'Pashmina shawl Rs 4,500' }] });
  });
  it('ignores a date, a counter and a clock', () => {
    expect(diffText('Last updated 20 November 2026', 'Last updated 27 November 2026').changed).toBe(false);
    expect(diffText('12 people viewing this shawl', '31 people viewing this shawl').changed).toBe(false);
    expect(diffText('Store closes at 5:30 pm today', 'Store closes at 6:45 pm today').changed).toBe(false);
  });
  it('ignores a cookie notice and tiny blocks', () => {
    expect(diffText('Shawls for sale in Kathmandu', 'Shawls for sale in Kathmandu\nWe use cookies to improve your experience').changed).toBe(false);
    expect(diffText('Shawls for sale in Kathmandu\nNew', 'Shawls for sale in Kathmandu\nSale').changed).toBe(false);
  });
  it('reports a new paragraph with an empty before', () => {
    const r = diffText('Shawls for sale in Kathmandu', 'Shawls for sale in Kathmandu\nFree delivery on every order this week');
    expect(r.blocks).toEqual([{ before: '', after: 'Free delivery on every order this week' }]);
  });
});
