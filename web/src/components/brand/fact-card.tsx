'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, History, Pencil, TriangleAlert, X } from 'lucide-react';
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { MutationError, SourceQuote, StatusBadge, Time } from '@/components/app';
import { api, errorMessage, type Schemas, unwrap } from '@/lib/api/client';
import { putFacts, refreshAll, Value, valueText, type Fact, type FieldDef } from './data';
import { formatDateOnly } from '@/lib/time';
import { expiryIso, parseValue, toInput, ValueInput } from './value-input';

/** The calls a fact card makes. Each puts the answer straight into the cached list. */
export function useFactActions(brandId: string) {
  const client = useQueryClient();
  const p = (id: string) => ({ path: { brandId, id } });
  return {
    approve: async (id: string) => putFacts(client, brandId, [await unwrap(api.POST('/api/brands/{brandId}/knowledge/facts/{id}/approve', { params: p(id) }))]),
    reject: async (id: string, reason: string) =>
      putFacts(client, brandId, [await unwrap(api.POST('/api/brands/{brandId}/knowledge/facts/{id}/reject', { params: p(id), body: reason ? { reason } : {} }))]),
    edit: async (id: string, body: { value: Fact['value']; unit?: string | null; expiresAt?: string | null }) =>
      putFacts(client, brandId, [await unwrap(api.PATCH('/api/brands/{brandId}/knowledge/facts/{id}', { params: p(id), body }))]),
    batch: async (ids: string[]) =>
      putFacts(client, brandId, await unwrap(api.POST('/api/brands/{brandId}/knowledge/facts/approve-batch', { params: { path: { brandId } }, body: { ids } }))),
    resolve: async (body: Schemas['ConflictResolve']) => {
      await unwrap(api.POST('/api/brands/{brandId}/knowledge/conflicts/resolve', { params: { path: { brandId } }, body }));
      await refreshAll(client, brandId);
    },
  };
}

/** The unit and expiry fields that go with a value for money, number and expiring fields. */
export function ValueExtras({ id, field, unit, setUnit, expiry, setExpiry }: { id: string; field: FieldDef | undefined; unit: string; setUnit: (s: string) => void; expiry: string; setExpiry: (s: string) => void }) {
  const hasUnit = field?.type === 'money' || field?.type === 'number';
  if (!hasUnit && !field?.asksExpiry) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {hasUnit ? (
        <div className="field">
          <label htmlFor={`${id}-unit`} className="label">{field?.type === 'money' ? 'Currency' : 'Unit'}</label>
          <input id={`${id}-unit`} className="input" value={unit} maxLength={20} onChange={(e) => setUnit(e.target.value)} />
        </div>
      ) : null}
      {field?.asksExpiry ? (
        <div className="field">
          <label htmlFor={`${id}-exp`} className="label">Valid until <span className="font-normal text-muted">(optional)</span></label>
          <input id={`${id}-exp`} className="input" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
        </div>
      ) : null}
    </div>
  );
}

function History_({ brandId, id }: { brandId: string; id: string }) {
  const h = useQuery({ queryKey: ['kb', brandId, 'history', id], queryFn: () => unwrap(api.GET('/api/brands/{brandId}/knowledge/facts/{id}/history', { params: { path: { brandId, id } } })) });
  if (h.isError) return <MutationError error={h.error} />;
  if (!h.data) return <p className="text-sm text-muted">Loading history…</p>;
  return (
    <ol aria-label="Versions, newest first" className="grid gap-1.5 text-sm">
      {[...h.data].sort((a, b) => b.version - a.version).map((v) => (
        <li key={v.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="num text-muted">v{v.version}</span>
          <StatusBadge status={v.status} />
          <span lang={v.language} className="min-w-0 break-words">{valueText(v.value, v.unit)}</span>
          <span className="text-muted">{v.verifiedBy ? `${v.verifiedBy}, ` : ''}<Time iso={v.verifiedAt ?? v.createdAt} year /></span>
        </li>
      ))}
    </ol>
  );
}

type Mode = 'view' | 'edit' | 'reject';

/**
 * One fact. Focus the row and press A to approve, E to edit, R to reject, J and K (or the arrow
 * keys) to move; every action is also a button with its own name.
 */
export function FactCard({ brandId, fact, field, showSubject }: { brandId: string; fact: Fact; field: FieldDef | undefined; showSubject?: boolean }) {
  const id = useId();
  const actions = useFactActions(brandId);
  const row = useRef<HTMLLIElement>(null);
  const [mode, setMode] = useState<Mode>('view');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState(false);
  const [text, setText] = useState(toInput(fact.value));
  const [unit, setUnit] = useState(fact.unit ?? (field?.type === 'money' ? 'NPR' : ''));
  const [expiry, setExpiry] = useState(fact.expiresAt?.slice(0, 10) ?? '');
  const [reason, setReason] = useState('');

  const name = `${showSubject && fact.subjectName ? `${fact.subjectName}, ` : ''}${fact.fieldLabel}`;
  const canApprove = fact.status === 'unverified' || fact.status === 'inferred' || fact.status === 'rejected' || fact.status === 'expired';
  const canReject = fact.status !== 'rejected';

  // Move focus to the neighbouring row once this one has left or changed, so a keyboard run keeps its place.
  async function run(fn: () => Promise<unknown>) {
    const all = [...document.querySelectorAll<HTMLElement>('[data-fact-row]')];
    const at = all.indexOf(row.current!);
    const keep = row.current?.contains(document.activeElement);
    const nextId = (all[at + 1] ?? all[at - 1])?.dataset.factRow;
    setBusy(true);
    setError(null);
    try {
      await fn();
      setMode('view');
      if (keep && nextId) requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-fact-row="${nextId}"]`)?.focus());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function onKey(e: KeyboardEvent<HTMLLIElement>) {
    if (e.target !== e.currentTarget || e.metaKey || e.ctrlKey || e.altKey) return;
    const all = [...document.querySelectorAll<HTMLElement>('[data-fact-row]')];
    const at = all.indexOf(e.currentTarget);
    const k = e.key.toLowerCase();
    if (k === 'j' || e.key === 'ArrowDown') all[at + 1]?.focus();
    else if (k === 'k' || e.key === 'ArrowUp') all[Math.max(0, at - 1)]?.focus();
    else if (k === 'a' && canApprove && !busy) void run(() => actions.approve(fact.id));
    else if (k === 'e' && fact.status !== 'conflicting') setMode('edit');
    else if (k === 'r' && canReject && fact.status !== 'conflicting') setMode('reject');
    else return;
    e.preventDefault();
  }

  const save = () =>
    run(() =>
      actions.edit(fact.id, {
        value: parseValue(field, text),
        ...(field?.type === 'money' || field?.type === 'number' ? { unit: unit.trim() || null } : {}),
        ...(field?.asksExpiry ? { expiresAt: expiryIso(expiry) } : {}),
      }),
    );

  return (
    <li
      ref={row}
      data-fact-row={fact.id}
      tabIndex={0}
      onKeyDown={onKey}
      aria-label={`${name}: ${valueText(fact.value, fact.unit)}, ${fact.status}`}
      className="grid gap-3 rounded-lg border border-line bg-panel p-4 transition-colors outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/30"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <h3 className="text-sm font-semibold text-muted">{fact.fieldLabel}</h3>
        <div className="flex items-center gap-2">
          {fact.confidence !== null && fact.origin !== 'owner' ? <span className="num text-xs text-muted">{Math.round(fact.confidence * 100)}% sure</span> : null}
          <StatusBadge status={fact.status} />
        </div>
      </div>

      {mode === 'edit' ? (
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <ValueInput id={`${id}-v`} field={field} label={`Value for ${fact.fieldLabel}`} value={text} onChange={setText} />
          <ValueExtras id={id} field={field} unit={unit} setUnit={setUnit} expiry={expiry} setExpiry={setExpiry} />
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn btn-primary" disabled={busy || !text.trim()}>Save and approve</button>
            <button type="button" className="btn btn-quiet" onClick={() => { setMode('view'); setText(toInput(fact.value)); }}>Cancel</button>
          </div>
        </form>
      ) : (
        <Value value={fact.value} unit={fact.unit} lang={fact.language} className="text-lg leading-snug font-medium" />
      )}

      {fact.expiresAt && mode !== 'edit' ? <p className="text-sm text-muted">Valid until {formatDateOnly(fact.expiresAt)}</p> : null}

      {fact.warning ? (
        <p className="flex items-start gap-2 rounded-md bg-[color-mix(in_oklab,var(--theme-highlight)_30%,transparent)] px-3 py-2 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} aria-hidden />
          <span>
            <span className="font-medium">{fact.warning.charAt(0).toUpperCase() + fact.warning.slice(1)}.</span> Prachaar worked this out; the source does not say it in these words. Check it before you approve.
          </span>
        </p>
      ) : null}

      {fact.source && fact.quote ? (
        <SourceQuote quote={fact.quote} source={fact.source} page={fact.page ?? undefined} />
      ) : fact.origin === 'owner' ? (
        <p className="text-sm text-muted">Entered by you{fact.verifiedAt ? <>, <Time iso={fact.verifiedAt} year /></> : null}</p>
      ) : null}

      {mode === 'reject' ? (
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => actions.reject(fact.id, reason.trim()));
          }}
        >
          <div className="field">
            <label htmlFor={`${id}-why`} className="label">Why reject it? <span className="font-normal text-muted">(optional)</span></label>
            <input id={`${id}-why`} className="input" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} autoFocus />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn btn-danger" disabled={busy}>Reject {fact.fieldLabel}</button>
            <button type="button" className="btn btn-quiet" onClick={() => setMode('view')}>Cancel</button>
          </div>
        </form>
      ) : null}

      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}

      {mode === 'view' && fact.status !== 'conflicting' ? (
        <div className="flex flex-wrap items-center gap-2">
          {canApprove ? (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void run(() => actions.approve(fact.id))} aria-label={`Approve ${name}`}>
              <Check className="size-4" aria-hidden /> Approve
            </button>
          ) : null}
          <button type="button" className="btn btn-secondary" onClick={() => setMode('edit')} aria-label={`Edit ${name}`}>
            <Pencil className="size-4" aria-hidden /> Edit
          </button>
          {canReject ? (
            <button type="button" className="btn btn-quiet" onClick={() => setMode('reject')} aria-label={`Reject ${name}`}>
              <X className="size-4" aria-hidden /> Reject
            </button>
          ) : null}
          <button type="button" className="btn btn-quiet ml-auto" aria-expanded={history} aria-label={`History of ${name}`} onClick={() => setHistory(!history)}>
            <History className="size-4" aria-hidden /> History
          </button>
        </div>
      ) : null}
      {history ? <History_ brandId={brandId} id={fact.id} /> : null}
    </li>
  );
}

/** Facts that disagree about one field: keep one, or type the right value. Pinned above the rest. */
export function ConflictGroup({ brandId, facts, field, onResolved }: { brandId: string; facts: Fact[]; field: FieldDef | undefined; onResolved?: () => void }) {
  const id = useId();
  const actions = useFactActions(brandId);
  const first = facts[0]!;
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState('');
  const [unit, setUnit] = useState(first.unit ?? (field?.type === 'money' ? 'NPR' : ''));
  const [expiry, setExpiry] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const title = `${first.subjectName ? `${first.subjectName}: ` : ''}${first.fieldLabel}`;

  async function resolve(body: Parameters<typeof actions.resolve>[0]) {
    setBusy(true);
    setError(null);
    try {
      await actions.resolve(body);
      onResolved?.();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <li data-conflict className="grid gap-4 rounded-lg border-2 border-danger/50 bg-panel p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">{title}: which is right?</h3>
        <StatusBadge status="conflicting" />
      </div>
      <p className="-mt-2 text-sm text-muted">These sources disagree. Nothing downstream can use this field until you choose.</p>
      <ul className="grid gap-3 md:grid-cols-2">
        {facts.map((f) => (
          <li key={f.id} className="grid content-start gap-3 rounded-md border border-line p-3">
            <Value value={f.value} unit={f.unit} lang={f.language} className="text-lg leading-snug font-medium" />
            {f.source && f.quote ? <SourceQuote quote={f.quote} source={f.source} page={f.page ?? undefined} /> : <p className="text-sm text-muted">No quote from a source.</p>}
            <button type="button" className="btn btn-primary justify-self-start" disabled={busy} aria-label={`Keep ${valueText(f.value, f.unit)} for ${title}`} onClick={() => void resolve({ keepFactId: f.id })}>
              Keep this value
            </button>
          </li>
        ))}
      </ul>
      {typing ? (
        <form
          className="grid gap-3 rounded-md bg-[color-mix(in_oklab,var(--theme-ink)_4%,transparent)] p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void resolve({
              section: first.section, subjectId: first.subjectId, field: first.field, language: first.language,
              value: parseValue(field, text),
              ...(field?.type === 'money' || field?.type === 'number' ? { unit: unit.trim() || null } : {}),
              ...(field?.asksExpiry ? { expiresAt: expiryIso(expiry) } : {}),
            });
          }}
        >
          <ValueInput id={`${id}-v`} field={field} label={`The right value for ${title}`} value={text} onChange={setText} />
          <ValueExtras id={id} field={field} unit={unit} setUnit={setUnit} expiry={expiry} setExpiry={setExpiry} />
          <div className="flex gap-2">
            <button type="submit" className="btn btn-primary" disabled={busy || !text.trim()}>Use this value</button>
            <button type="button" className="btn btn-quiet" onClick={() => setTyping(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <button type="button" className="btn btn-secondary justify-self-start" onClick={() => setTyping(true)} aria-label={`Type the right value for ${title}`}>
          Neither: type the right value
        </button>
      )}
      {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
    </li>
  );
}
