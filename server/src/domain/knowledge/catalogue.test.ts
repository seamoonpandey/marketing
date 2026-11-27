import { describe, expect, it } from 'vitest';
import { CATALOGUE } from './catalogue.ts';

describe('catalogue', () => {
  it('has exactly the nine sections', () => {
    expect(CATALOGUE.map((s) => s.key).sort()).toEqual(
      ['audience', 'business_model', 'goals', 'identity', 'legal', 'positioning', 'products', 'visual', 'voice'],
    );
  });

  it('has no duplicate field key within a section, and every enum has options', () => {
    for (const s of CATALOGUE) {
      const keys = s.fields.map((f) => f.key);
      expect(new Set(keys).size, s.key).toBe(keys.length);
      for (const f of s.fields) if (f.type === 'enum') expect(f.options?.length, `${s.key}.${f.key}`).toBeGreaterThan(0);
    }
  });

  it('gives products and audience their subjects, and asks a price for an expiry', () => {
    expect(CATALOGUE.find((s) => s.key === 'products')?.subject).toBe('product');
    expect(CATALOGUE.find((s) => s.key === 'audience')?.subject).toBe('segment');
    const price = CATALOGUE.find((s) => s.key === 'products')?.fields.find((f) => f.key === 'price');
    expect(price).toMatchObject({ type: 'money', asksExpiry: true, multi: false });
  });
});
