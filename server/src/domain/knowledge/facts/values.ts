import { asciiDigits, foldText, stripInvisible } from '../../../text/normalise.ts';
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

const fold = (v: unknown): unknown => (typeof v === 'string' ? foldText(v) : Array.isArray(v) ? v.map(fold) : v);
const foldUnit = (u: string | null | undefined) => foldText(u ?? '');

/** Only a JS number or plain digits (of any script) count as a number; anything else compares as text. */
const asNumber = (v: unknown) => {
  const s = typeof v === 'string' ? asciiDigits(stripInvisible(v)).trim() : null;
  return typeof v === 'number' ? v : s !== null && PLAIN_NUMBER.test(s) ? Number(s) : null;
};

/**
 * Equal for the conflict rule: text in its comparison form (foldText), so a value disguised by invisible
 * characters, look-alike letters or other digits is not a new value; number and money numerically when both
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
