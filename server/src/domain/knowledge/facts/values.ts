import type { FieldDef } from '../catalogue.ts';

const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const text = (v: unknown, max = 10_000) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;

/** True when the value fits the field's type (see FactValue in contracts/knowledge.ts). */
export function validValue(def: FieldDef, v: unknown): boolean {
  switch (def.type) {
    case 'text':
    case 'longtext':
      return text(v);
    case 'number':
    case 'money':
      // A number, or the source's own text (such as "रु ४,५००"), which is kept as written.
      return (typeof v === 'number' && Number.isFinite(v)) || text(v, 200);
    case 'enum':
      return typeof v === 'string' && !!def.options?.includes(v);
    case 'list':
      return Array.isArray(v) && v.length <= 100 && v.every((x) => text(x, 2000));
    case 'url':
      if (!text(v, 2048)) return false;
      try {
        return /^https?:$/.test(new URL(v as string).protocol);
      } catch {
        return false;
      }
    case 'date':
      return typeof v === 'string' && DATE.test(v) && !Number.isNaN(Date.parse(v));
  }
}

const foldText = (s: string) => s.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
const fold = (v: unknown): unknown => (typeof v === 'string' ? foldText(v) : Array.isArray(v) ? v.map(fold) : v);
const foldUnit = (u: string | null | undefined) => (u ?? '').trim().toUpperCase();

/** Only a JS number or plain ASCII digits count as a number; anything else compares as text. */
const asNumber = (v: unknown) =>
  typeof v === 'number' ? v : typeof v === 'string' && PLAIN_NUMBER.test(v.trim()) ? Number(v) : null;

/**
 * Equal for the conflict rule: text trimmed and case-folded; number and money numerically when both
 * are numbers in the same unit. A different unit is a different value.
 */
export function sameValue(def: FieldDef, a: unknown, aUnit: string | null | undefined, b: unknown, bUnit: string | null | undefined): boolean {
  if (foldUnit(aUnit) !== foldUnit(bUnit)) return false;
  if (def.type === 'number' || def.type === 'money') {
    const x = asNumber(a);
    const y = asNumber(b);
    if (x !== null && y !== null) return x === y;
  }
  return JSON.stringify(fold(a)) === JSON.stringify(fold(b));
}
