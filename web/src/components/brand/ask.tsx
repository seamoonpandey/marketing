'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useId, useState } from 'react';
import { MutationError, useBrand } from '@/components/app';
import { api, unwrap, type Schemas } from '@/lib/api/client';
import { refreshAll, useCatalogue, useFacts, Value, type FactValue, type FieldDef } from './data';
import { useFactActions, ValueExtras } from './fact-card';
import { expiryIso, parseValue, ValueInput } from './value-input';

type Ask = Schemas['ReadinessAsk'];
type Entry = { text: string; unit: string; expiry: string };
type Answer = { field: FieldDef; value: FactValue; unit?: string | null; expiresAt?: string | null };
const BLANK: Entry = { text: '', unit: 'NPR', expiry: '' };
const FOUND = ['unverified', 'inferred'];

/** A multi-valued text field is typed one value per line, like a list, and saved as one fact per line. */
const asTyped = (f: FieldDef): FieldDef => (f.multi && f.type === 'text' ? { ...f, type: 'list' } : f);
const several = (f: FieldDef) => f.multi || f.type === 'list';

/** One readiness criterion asked in place: plain questions, what the website gave, a draft, and the owner's own answer. */
export function AskCard({ brandId, ask, fixPath }: { brandId: string; ask: Ask; fixPath: string }) {
  const id = useId();
  const client = useQueryClient();
  const brand = useBrand(brandId);
  const catalogue = useCatalogue(brandId);
  const facts = useFacts(brandId);
  const actions = useFactActions(brandId);
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [groupName, setGroupName] = useState('');

  const section = catalogue.data?.find((s) => s.key === ask.section);
  const fields = ask.fields.map((k) => section?.fields.find((f) => f.key === k)).filter((f): f is FieldDef => !!f);
  const entry = (k: string) => entries[k] ?? BLANK;
  const set = (k: string, p: Partial<Entry>) => setEntries((e) => ({ ...e, [k]: { ...(e[k] ?? BLANK), ...p } }));
  const creating = !!section && section.subject !== 'brand' && !ask.subjectId;
  const newName = ask.section === 'products' ? entry('name').text.trim() : groupName.trim();
  const live = (facts.data ?? []).filter((x) => x.isCurrent && FOUND.includes(x.status) && x.section === ask.section);
  const found = (f: FieldDef) => live.filter((x) => x.field === f.key && (x.subjectId ?? null) === ask.subjectId).slice(0, 3);
  // A new product or segment: the website may already have given some, waiting in review.
  const foundGroups = creating ? [...new Set(live.map((x) => x.subjectName).filter(Boolean))] : [];

  const save = useMutation({
    mutationFn: async (answers: Answer[]) => {
      let subjectId = ask.subjectId;
      if (creating) {
        const type = section!.subject as 'product' | 'segment';
        subjectId = (await unwrap(api.POST('/api/brands/{brandId}/knowledge/subjects', { params: { path: { brandId } }, body: { type, name: newName } }))).id;
      }
      for (const a of answers) {
        await unwrap(api.POST('/api/brands/{brandId}/knowledge/facts', {
          params: { path: { brandId } },
          body: {
            section: ask.section, subjectId, field: a.field.key, value: a.value, language: brand.data?.defaultLanguage || 'en',
            ...(a.unit !== undefined ? { unit: a.unit } : {}), ...(a.expiresAt !== undefined ? { expiresAt: a.expiresAt } : {}),
          },
        }));
      }
    },
    onSuccess: () => {
      setEntries({});
      return refreshAll(client, brandId);
    },
  });
  const use = useMutation({ mutationFn: (factId: string) => actions.approve(factId) });
  const draft = useMutation({
    mutationFn: (f: FieldDef) =>
      unwrap(api.POST('/api/brands/{brandId}/knowledge/drafts', { params: { path: { brandId } }, body: { section: ask.section, field: f.key } })),
    onSuccess: (d, f) => {
      if (d.values.length) set(f.key, { text: several(f) ? d.values.join('\n') : d.values[0]! });
    },
  });

  const typed: Answer[] = fields.flatMap((f) => {
    const e = entry(f.key);
    if (!e.text.trim()) return [];
    const extra = {
      ...(f.type === 'money' || f.type === 'number' ? { unit: e.unit.trim() || null } : {}),
      ...(f.asksExpiry ? { expiresAt: expiryIso(e.expiry) } : {}),
    };
    if (f.multi && f.type === 'text') return e.text.split('\n').map((s) => s.trim()).filter(Boolean).map((value) => ({ field: f, value, ...extra }));
    return [{ field: f, value: parseValue(f, e.text), ...extra }];
  });
  const busy = save.isPending || use.isPending;

  if (!section) return <p className="text-sm text-muted">{catalogue.isError ? 'The questions could not be loaded.' : 'Loading the questions…'}</p>;
  return (
    <form
      className="grid gap-5 rounded-lg border border-line bg-panel p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (typed.length && (!creating || newName)) save.mutate(typed);
      }}
    >
      {ask.subjectName ? <p className="text-sm font-semibold break-words">For {ask.subjectName}</p> : null}
      {foundGroups.length ? (
        <p className="text-sm">
          Prachaar found {foundGroups.length === 1 ? 'one' : foundGroups.length} on your website: {foundGroups.join(', ')}.{' '}
          <Link href={fixPath} className="font-medium text-action underline">Check {foundGroups.length === 1 ? 'it' : 'them'} in review</Link>, or add one here.
        </p>
      ) : null}
      {creating && ask.section !== 'products' ? (
        <div className="field">
          <label htmlFor={`${id}-group`} className="label">Who are these customers?</label>
          <input id={`${id}-group`} className="input" value={groupName} maxLength={200} aria-describedby={`${id}-group-ex`} onChange={(e) => setGroupName(e.target.value)} />
          <p id={`${id}-group-ex`} className="hint">Example: Tea lovers in Kathmandu</p>
        </div>
      ) : null}

      {fields.map((f) => {
        const fid = `${id}-${f.key}`;
        const offers = found(f);
        const drafted = draft.variables?.key === f.key ? draft : null;
        return (
          <div key={f.key} className="grid gap-3">
            <ValueInput id={fid} field={asTyped(f)} label={f.question ?? f.label} why={f.why} value={entry(f.key).text} onChange={(text) => set(f.key, { text })} />
            <ValueExtras id={fid} field={f} unit={entry(f.key).unit} setUnit={(unit) => set(f.key, { unit })} expiry={entry(f.key).expiry} setExpiry={(expiry) => set(f.key, { expiry })} />
            {offers.length ? (
              <div className="grid gap-2 rounded-md border border-line p-3">
                <p className="text-sm font-medium">Prachaar found this on your website</p>
                <ul className="grid gap-2">
                  {offers.map((x) => (
                    <li key={x.id} className="flex flex-wrap items-center justify-between gap-2">
                      <Value value={x.value} unit={x.unit} lang={x.language} className="min-w-0 break-words" />
                      <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => use.mutate(x.id)}>Use this</button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {f.draftable || f.none ? (
              <div className="flex flex-wrap gap-2">
                {f.draftable ? (
                  <button type="button" className="btn btn-secondary" disabled={draft.isPending || busy} onClick={() => draft.mutate(f)}>
                    <Sparkles className="size-4" aria-hidden /> {drafted?.isPending ? 'Drafting…' : 'Draft it for me'}
                  </button>
                ) : null}
                {f.none ? (
                  <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => save.mutate([{ field: f, value: f.none!.value }])}>{f.none.label}</button>
                ) : null}
              </div>
            ) : null}
            {drafted?.data ? (
              <p role="status" className="text-sm text-muted">
                {drafted.data.values.length
                  ? `Prachaar drafted this from your website and approved facts (cost NPR ${drafted.data.cost.npr}). Check it and change anything that is not right, then save.`
                  : 'Prachaar found nothing to draft this from. Write it yourself, or import your website first.'}
              </p>
            ) : null}
            {drafted ? <MutationError error={drafted.error} /> : null}
          </div>
        );
      })}

      <MutationError error={save.error ?? use.error} />
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={busy || !typed.length || (creating && !newName)}>
          {save.isPending ? 'Saving…' : 'Save and approve'}
        </button>
        <p className="text-sm text-muted">Saving approves it as your answer. You can change it later in Review.</p>
      </div>
    </form>
  );
}
