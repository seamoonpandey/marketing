import { describe, expect, it } from 'vitest';
import type { FieldDef } from '../catalogue.ts';
import { sameValue } from './values.ts';

const def = (type: FieldDef['type']): FieldDef => ({ key: 'k', label: 'K', type, multi: false });

describe('sameValue', () => {
  it('reads a value disguised by tricks fixed in Studio and Approve as the same value, so it raises no conflict', () => {
    const t = def('text');
    for (const v of ['Refunds within 7​ days', 'Refunds within 7 dаys', 'REFUNDS  within ७ days', 'Refunds within 7\u0007 days'])
      expect([v, sameValue(t, 'Refunds within 7 days', null, v, null)]).toEqual([v, true]);
    expect(sameValue(t, 'Refunds within 7 days', null, 'Refunds within 14 days', null)).toBe(false);
    expect(sameValue(def('money'), 4500, 'NPR', '४५००', 'ＮＰＲ')).toBe(true);
    expect(sameValue(def('money'), 4500, 'NPR', '4,500', 'NPR')).toBe(false);
  });
});
