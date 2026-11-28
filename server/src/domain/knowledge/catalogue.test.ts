import { describe, expect, it } from 'vitest';
import { CATALOGUE } from './catalogue.ts';
import { EXTRACTION_SYSTEM } from './import/prompt.ts';

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

  it('gives every typed field an example, never an enum or date, and never sends one to the model', () => {
    for (const s of CATALOGUE) {
      for (const f of s.fields) {
        const id = `${s.key}.${f.key}`;
        if (f.type === 'enum' || f.type === 'date') expect(f.example, id).toBeUndefined();
        else expect(f.example?.trim(), id).toBeTruthy();
        if (f.example && f.example.length > 12) expect(EXTRACTION_SYSTEM, id).not.toContain(f.example);
      }
    }
  });
});
