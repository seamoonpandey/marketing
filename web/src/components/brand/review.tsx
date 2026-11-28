'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { GitCompareArrows, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useId, useMemo, useState } from 'react';
import { Async, MutationError, PageHeader, StateBlock, useBrand, useBrandId } from '@/components/app';
import { api, errorMessage, unwrap } from '@/lib/api/client';
import { refreshAll, useCatalogue, useCompetitors, useFacts, useSubjects, type Fact, type SectionDef } from './data';
import { ConflictGroup, FactCard, useFactActions, ValueExtras } from './fact-card';
import { expiryIso, parseValue, ValueInput } from './value-input';

const PENDING = ['unverified', 'inferred', 'conflicting', 'expired'];
type Filter = 'review' | 'approved' | 'rejected' | 'all';
const FILTERS: { id: Filter; label: string; test: (f: Fact) => boolean }[] = [
  { id: 'review', label: 'To review', test: (f) => PENDING.includes(f.status) },
  { id: 'approved', label: 'Approved', test: (f) => f.status === 'approved' },
  { id: 'rejected', label: 'Rejected', test: (f) => f.status === 'rejected' },
  { id: 'all', label: 'All', test: () => true },
];

export function ReviewScreen() {
  const brandId = useBrandId()!;
  const catalogue = useCatalogue(brandId);
  const facts = useFacts(brandId);
  return (
    <>
      <PageHeader
        title="Review facts"
        description="Approve what is right, fix what is not, reject what is wrong. Only approved facts reach the brand book and the modules that use it."
      />
      <Async q={catalogue} what="brand fields" rows={4}>
        {(sections) => (
          <Async q={facts} what="facts" rows={6}>{(items) => <Workspace brandId={brandId} sections={sections} facts={items} />}</Async>
        )}
      </Async>
    </>
  );
}

function Workspace({ brandId, sections, facts }: { brandId: string; sections: SectionDef[]; facts: Fact[] }) {
  const param = useSearchParams().get('section');
  const [filter, setFilter] = useState<Filter>('review');
  const current = facts.filter((f) => f.isCurrent);
  const bySection = (k: string) => current.filter((f) => f.section === k);
  const pending = (k: string) => bySection(k).filter((f) => PENDING.includes(f.status)).length;
  const conflicts = (k: string) => bySection(k).filter((f) => f.status === 'conflicting').length;

  // Chosen once: resolving the last conflict must not move the owner to another section.
  const [fallback] = useState(() => sections.find((s) => conflicts(s.key))?.key ?? sections.find((s) => pending(s.key))?.key ?? sections[0]?.key);
  const active = param === 'competitors' || sections.some((s) => s.key === param) ? param! : fallback;
  const section = sections.find((s) => s.key === active);
  const totalConflicts = sections.reduce((n, s) => n + conflicts(s.key), 0);
  const href = (k: string) => `/app/b/${brandId}/brand/review?section=${k}`;

  return (
    <div className="grid gap-6 lg:grid-cols-[14.5rem_minmax(0,1fr)] lg:items-start">
      <nav aria-label="Sections" className="lg:sticky lg:top-6">
        <ul className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
          {sections.map((s) => {
            const n = pending(s.key);
            const c = conflicts(s.key);
            return (
              <li key={s.key} className="shrink-0">
                <Link
                  href={href(s.key)}
                  replace
                  aria-current={s.key === active ? 'page' : undefined}
                  className={`flex min-h-9 items-center justify-between gap-3 rounded-md px-2.5 py-1.5 text-sm font-medium whitespace-nowrap ${
                    s.key === active ? 'bg-panel text-ink shadow-[0_1px_2px_var(--color-line)]' : 'text-muted hover:bg-[color-mix(in_oklab,var(--theme-ink)_6%,transparent)] hover:text-ink'
                  }`}
                >
                  {s.label}
                  <span className="flex items-center gap-1.5">
                    {c ? <GitCompareArrows className="size-3.5 text-danger" aria-label={`${c} conflict${c > 1 ? 's' : ''}`} /> : null}
                    {n ? <span className="num rounded-full bg-[color-mix(in_oklab,var(--theme-ink)_8%,transparent)] px-1.5 text-xs" aria-label={`${n} to review`}>{n}</span> : null}
                  </span>
                </Link>
              </li>
            );
          })}
          <li className="shrink-0 lg:mt-2 lg:border-t lg:border-line lg:pt-2">
            <Link
              href={href('competitors')}
              replace
              aria-current={active === 'competitors' ? 'page' : undefined}
              className={`flex min-h-9 items-center rounded-md px-2.5 py-1.5 text-sm font-medium whitespace-nowrap ${
                active === 'competitors' ? 'bg-panel text-ink shadow-[0_1px_2px_var(--color-line)]' : 'text-muted hover:bg-[color-mix(in_oklab,var(--theme-ink)_6%,transparent)] hover:text-ink'
              }`}
            >
              Competitors
            </Link>
          </li>
        </ul>
      </nav>

      <div className="grid min-w-0 gap-5">
        {totalConflicts && active !== 'competitors' ? (
          <p role="status" className="flex items-center gap-2 text-sm font-medium text-danger">
            <GitCompareArrows className="size-4" aria-hidden />
            {totalConflicts} conflict{totalConflicts > 1 ? 's' : ''} to resolve across the brand. They are pinned first.
          </p>
        ) : null}
        {active === 'competitors' ? (
          <CompetitorsPanel brandId={brandId} />
        ) : section ? (
          <SectionView key={section.key} brandId={brandId} section={section} facts={bySection(section.key)} filter={filter} setFilter={setFilter} />
        ) : (
          <StateBlock state="empty" title="No sections">The brand fields did not load.</StateBlock>
        )}
      </div>
    </div>
  );
}

function SectionView({ brandId, section, facts, filter, setFilter }: { brandId: string; section: SectionDef; facts: Fact[]; filter: Filter; setFilter: (f: Filter) => void }) {
  const actions = useFactActions(brandId);
  const fieldOf = (k: string) => section.fields.find((f) => f.key === k);
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const test = FILTERS.find((f) => f.id === filter)!.test;
  const shown = facts.filter(test);
  const conflicting = shown.filter((f) => f.status === 'conflicting');
  const groups = useMemo(() => {
    const m = new Map<string, Fact[]>();
    for (const f of conflicting) m.set(`${f.subjectId}|${f.field}`, [...(m.get(`${f.subjectId}|${f.field}`) ?? []), f]);
    return [...m.values()];
  }, [conflicting]);
  const rest = shown.filter((f) => f.status !== 'conflicting');
  const eligible = rest.filter((f) => f.status === 'unverified');
  const skippedInferred = rest.filter((f) => f.status === 'inferred').length;

  // Group the rest by subject (a product, a segment), fields in catalogue order.
  const order = (f: Fact) => section.fields.findIndex((x) => x.key === f.field);
  const subjects = [...new Set(rest.map((f) => f.subjectId ?? ''))].map((sid) => ({
    sid, name: rest.find((f) => (f.subjectId ?? '') === sid)?.subjectName ?? null,
    facts: rest.filter((f) => (f.subjectId ?? '') === sid).sort((a, b) => order(a) - order(b)),
  }));

  async function approveShown() {
    setBusy(true);
    setNote(null);
    try {
      await actions.batch(eligible.map((f) => f.id));
      setNote({ ok: true, text: `Approved ${eligible.length} fact${eligible.length > 1 ? 's' : ''}.` });
    } catch (e) {
      setNote({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <section aria-label={section.label} className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">{section.label}</h2>
        <div role="group" aria-label="Show" className="flex gap-1 rounded-lg bg-[color-mix(in_oklab,var(--theme-ink)_6%,transparent)] p-1">
          {FILTERS.map((f) => (
            <button
              key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => { setFilter(f.id); setConfirming(false); setNote(null); }}
              className={`h-7 rounded-md px-2.5 text-sm font-medium ${filter === f.id ? 'bg-panel shadow-[0_1px_2px_var(--color-line)]' : 'text-muted hover:text-ink'}`}
            >
              {f.label} <span className="num text-xs opacity-70">{facts.filter(f.test).length}</span>
            </button>
          ))}
        </div>
      </div>

      {eligible.length || note ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-panel px-4 py-3">
          {confirming ? (
            <>
              <p className="text-sm font-medium">Approve {eligible.length} quote-checked fact{eligible.length > 1 ? 's' : ''}?</p>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void approveShown()}>Yes, approve {eligible.length}</button>
              <button type="button" className="btn btn-quiet" onClick={() => setConfirming(false)}>Cancel</button>
            </>
          ) : (
            <>
              {eligible.length ? (
                <button type="button" className="btn btn-secondary" onClick={() => { setConfirming(true); setNote(null); }}>
                  Approve all shown ({eligible.length})
                </button>
              ) : null}
              <p className="text-sm text-muted">
                {eligible.length ? 'Covers facts whose quote was found in the source. ' : ''}
                {conflicting.length || skippedInferred
                  ? `Skips ${[conflicting.length ? `${conflicting.length} conflicting` : '', skippedInferred ? `${skippedInferred} inferred` : ''].filter(Boolean).join(' and ')}.`
                  : ''}
              </p>
            </>
          )}
          {note ? <p role={note.ok ? 'status' : 'alert'} className={`text-sm font-medium ${note.ok ? 'text-success' : 'text-danger'}`}>{note.text}</p> : null}
        </div>
      ) : null}

      {groups.length ? (
        <ul aria-label="Conflicts" className="grid gap-4">
          {groups.map((g) => (
            <ConflictGroup key={`${g[0]!.subjectId}|${g[0]!.field}`} brandId={brandId} facts={g} field={fieldOf(g[0]!.field)} />
          ))}
        </ul>
      ) : null}

      {subjects.map((s) => (
        <div key={s.sid} className="grid gap-3">
          {s.name ? <h3 className="text-base font-semibold">{s.name}</h3> : null}
          <ul aria-label={s.name ? `Facts about ${s.name}` : `${section.label} facts`} className="grid gap-3">
            {s.facts.map((f) => <FactCard key={f.id} brandId={brandId} fact={f} field={fieldOf(f.field)} showSubject={!!s.name} />)}
          </ul>
        </div>
      ))}

      {!shown.length ? (
        facts.length ? (
          <StateBlock state="empty" size="inline" title={filter === 'review' ? 'Nothing left to review here' : 'No facts match this view'}>
            {filter === 'review' ? 'Every fact in this section has an answer. Look at Approved, or add a value below.' : 'Try another view.'}
          </StateBlock>
        ) : (
          <StateBlock state="empty" size="inline" title={`No ${section.label.toLowerCase()} facts yet`}>
            Import the website and files from Sources, or add the first value yourself below.
          </StateBlock>
        )
      ) : (
        <p className="text-sm text-muted">
          Keyboard: focus a fact, then <kbd className="num rounded border border-line-strong px-1">A</kbd> approves, <kbd className="num rounded border border-line-strong px-1">E</kbd> edits, <kbd className="num rounded border border-line-strong px-1">R</kbd> rejects, <kbd className="num rounded border border-line-strong px-1">J</kbd> and <kbd className="num rounded border border-line-strong px-1">K</kbd> move.
        </p>
      )}

      <AddFact brandId={brandId} section={section} startOpen={!facts.length} />
    </section>
  );
}

/** The owner's own value. A single-valued field that already has one is edited (a new version), as the API says. */
function AddFact({ brandId, section, startOpen }: { brandId: string; section: SectionDef; startOpen: boolean }) {
  const id = useId();
  const client = useQueryClient();
  const brand = useBrand(brandId);
  const subjects = useSubjects(brandId);
  const needsSubject = section.subject !== 'brand';
  const [fieldKey, setFieldKey] = useState(section.fields[0]?.key ?? '');
  const [subject, setSubject] = useState('');
  const [newName, setNewName] = useState('');
  const [text, setText] = useState('');
  const [unit, setUnit] = useState('NPR');
  const [expiry, setExpiry] = useState('');
  const [lang, setLang] = useState('');
  const field = section.fields.find((f) => f.key === fieldKey);
  const mine = (subjects.data ?? []).filter((s) => s.type === section.subject);
  const creating = needsSubject && (subject === '__new' || (!subject && !mine.length));

  const add = useMutation({
    mutationFn: async () => {
      let subjectId: string | null = null;
      if (needsSubject) {
        subjectId = creating
          ? (await unwrap(api.POST('/api/brands/{brandId}/knowledge/subjects', { params: { path: { brandId } }, body: { type: section.subject as 'product' | 'segment', name: newName.trim() } }))).id
          : subject || mine[0]!.id;
      }
      return unwrap(
        api.POST('/api/brands/{brandId}/knowledge/facts', {
          params: { path: { brandId } },
          body: {
            section: section.key, subjectId, field: fieldKey, value: parseValue(field, text), language: lang || brand.data?.defaultLanguage || 'en',
            ...(field?.type === 'money' || field?.type === 'number' ? { unit: unit.trim() || null } : {}),
            ...(field?.asksExpiry ? { expiresAt: expiryIso(expiry) } : {}),
          },
        }),
      );
    },
    onSuccess: async () => {
      setText('');
      setExpiry('');
      setNewName('');
      await refreshAll(client, brandId);
    },
  });

  return (
    <details className="panel group" open={startOpen || undefined}>
      <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-4 text-sm font-semibold">
        <Plus className="size-4" aria-hidden /> Add your own value
      </summary>
      <form
        className="grid gap-4 border-t border-line p-4"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="field">
            <label htmlFor={`${id}-f`} className="label">Field</label>
            <select id={`${id}-f`} className="input" value={fieldKey} onChange={(e) => setFieldKey(e.target.value)}>
              {section.fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
          </div>
          {needsSubject ? (
            <div className="field">
              <label htmlFor={`${id}-s`} className="label">{section.subject === 'product' ? 'Product' : 'Audience segment'}</label>
              <select id={`${id}-s`} className="input" value={creating ? '__new' : subject || mine[0]?.id} onChange={(e) => setSubject(e.target.value)}>
                {mine.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                <option value="__new">New {section.subject === 'product' ? 'product' : 'segment'}…</option>
              </select>
            </div>
          ) : null}
        </div>
        {creating ? (
          <div className="field">
            <label htmlFor={`${id}-n`} className="label">Name of the new {section.subject === 'product' ? 'product' : 'segment'}</label>
            <input id={`${id}-n`} className="input" value={newName} maxLength={200} onChange={(e) => setNewName(e.target.value)} />
          </div>
        ) : null}
        <ValueInput id={`${id}-v`} field={field} label={`Value for ${field?.label ?? 'the field'}`} value={text} onChange={setText} />
        <ValueExtras id={id} field={field} unit={unit} setUnit={setUnit} expiry={expiry} setExpiry={setExpiry} />
        <div className="field max-w-48">
          <label htmlFor={`${id}-l`} className="label">Language of the value</label>
          <select id={`${id}-l`} className="input" value={lang || brand.data?.defaultLanguage || 'en'} onChange={(e) => setLang(e.target.value)}>
            <option value="en">English</option>
            <option value="ne">नेपाली (Nepali)</option>
          </select>
        </div>
        <MutationError error={add.error} />
        <div>
          <button type="submit" className="btn btn-primary" disabled={add.isPending || !text.trim() || (creating && !newName.trim())}>
            {add.isPending ? 'Adding…' : 'Add and approve'}
          </button>
        </div>
      </form>
    </details>
  );
}

function CompetitorsPanel({ brandId }: { brandId: string }) {
  const id = useId();
  const client = useQueryClient();
  const list = useCompetitors(brandId);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'direct' | 'indirect' | 'aspirational'>('direct');
  const [site, setSite] = useState('');
  const refresh = () => refreshAll(client, brandId);
  const add = useMutation({
    mutationFn: () => {
      const s = site.trim();
      return unwrap(api.POST('/api/brands/{brandId}/competitors', { params: { path: { brandId } }, body: { name: name.trim(), kind, site: s ? (/^https?:\/\//i.test(s) ? s : `https://${s}`) : null } }));
    },
    onSuccess: async () => { setName(''); setSite(''); await refresh(); },
  });
  const remove = useMutation({
    mutationFn: (cid: string) => unwrap(api.DELETE('/api/brands/{brandId}/competitors/{id}', { params: { path: { brandId, id: cid } } })),
    onSuccess: refresh,
  });

  return (
    <section aria-label="Competitors" className="grid gap-5">
      <div className="grid gap-1">
        <h2 className="text-xl font-semibold">Competitors</h2>
        <p className="max-w-[65ch] text-sm text-muted">Readiness asks for three, each with a website. Research watches them later.</p>
      </div>
      <Async q={list} what="competitors" rows={2}>
        {(items) =>
          items.length ? (
            <ul aria-label="Competitors" className="grid gap-2">
              {items.map((c) => (
                <li key={c.id} className="panel flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <div className="grid min-w-0 gap-0.5">
                    <span className="font-semibold break-words">{c.name}</span>
                    <span className="text-sm break-all text-muted">{c.kind}{c.site ? ` · ${c.site}` : ' · no website yet'}</span>
                  </div>
                  <button type="button" className="btn btn-quiet" aria-label={`Remove ${c.name}`} onClick={() => remove.mutate(c.id)} disabled={remove.isPending}>
                    <Trash2 className="size-4" aria-hidden /> Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <StateBlock state="empty" size="inline" title="No competitors yet" action={<Link href={`/app/b/${brandId}/research/discover`} className="btn btn-primary">Find competitors</Link>}>
              Let Prachaar search for them, or add the brands your customers compare you with.
            </StateBlock>
          )
        }
      </Async>
      <form className="panel grid gap-4 p-4" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
        <h3 className="text-base font-semibold">Add a competitor</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="field">
            <label htmlFor={`${id}-n`} className="label">Name</label>
            <input id={`${id}-n`} className="input" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor={`${id}-k`} className="label">Kind</label>
            <select id={`${id}-k`} className="input" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="direct">Direct</option>
              <option value="indirect">Indirect</option>
              <option value="aspirational">Aspirational</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor={`${id}-s`} className="label">Website</label>
            <input id={`${id}-s`} className="input" inputMode="url" value={site} placeholder="example.com.np" onChange={(e) => setSite(e.target.value)} />
          </div>
        </div>
        <MutationError error={add.error} />
        <div><button type="submit" className="btn btn-primary" disabled={add.isPending || !name.trim()}>{add.isPending ? 'Adding…' : 'Add competitor'}</button></div>
      </form>
    </section>
  );
}
