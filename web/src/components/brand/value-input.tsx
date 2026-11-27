'use client';

import type { FactValue, FieldDef } from './data';

/** What the owner typed, as the API value: lists one item per line; numbers only when plainly numeric (a price such as "रु ४,५००" stays text). */
export function parseValue(field: FieldDef | undefined, raw: string): FactValue {
  const t = raw.trim();
  if (field?.type === 'list') return t.split('\n').map((s) => s.trim()).filter(Boolean);
  if ((field?.type === 'number' || field?.type === 'money') && /^\d+(\.\d+)?$/.test(t)) return Number(t);
  return t;
}

export function toInput(v: FactValue | undefined): string {
  return v === undefined ? '' : Array.isArray(v) ? v.join('\n') : String(v);
}

/** The control that fits a catalogue field type, with its visible label. */
export function ValueInput({ id, field, label, value, onChange }: { id: string; field: FieldDef | undefined; label: string; value: string; onChange: (v: string) => void }) {
  const t = field?.type ?? 'text';
  let control;
  if (t === 'enum') {
    control = (
      <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose…</option>
        {field?.options?.map((o) => <option key={o} value={o}>{o.replaceAll('_', ' ')}</option>)}
      </select>
    );
  } else if (t === 'longtext' || t === 'list') {
    control = (
      <textarea id={id} className="input min-h-24 py-2 leading-relaxed" rows={t === 'list' ? 4 : 3} value={value} onChange={(e) => onChange(e.target.value)} aria-describedby={t === 'list' ? `${id}-hint` : undefined} />
    );
  } else {
    control = (
      <input id={id} className="input" type={t === 'date' ? 'date' : t === 'url' ? 'url' : 'text'} inputMode={t === 'number' || t === 'money' ? 'decimal' : undefined} value={value} onChange={(e) => onChange(e.target.value)} />
    );
  }
  return (
    <div className="field">
      <label htmlFor={id} className="label">{label}</label>
      {control}
      {t === 'list' ? <p id={`${id}-hint`} className="hint">One item per line.</p> : null}
    </div>
  );
}

/** A date input's value as the API's date-time (end of that day, UTC). */
export const expiryIso = (d: string) => (d ? `${d}T23:59:59Z` : null);
