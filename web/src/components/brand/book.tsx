'use client';

import { ArrowRight, Check, CircleDashed, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { PageHeader, StateBlock, useBrandId } from '@/components/app';
import type { Schemas } from '@/lib/api/client';
import { Loaded, useBook, Value, type Fact } from './data';

type Readiness = Schemas['Readiness'];

const BAND: Record<Readiness['band'], string> = { blocked: 'Blocked', draft_only: 'Draft only', limited_pilot: 'Limited pilot', automation: 'Automation' };

export function BookScreen() {
  const brandId = useBrandId()!;
  const book = useBook(brandId);
  return (
    <>
      <PageHeader title="Brand book" description="The approved brand, and how ready it is for Prachaar to work from." />
      <Loaded query={book} what="The brand book" rows={5}>
        {(b) => {
          const approved = b.sections.reduce((n, s) => n + s.facts.length, 0);
          const empty = !approved && !b.assets.length && !b.palette.colours.length && !b.competitors.length;
          return (
            <div className="grid gap-8">
              <ReadinessCard r={b.readiness} />
              {empty ? (
                <StateBlock
                  state="empty" title="Nothing approved yet"
                  action={<Link href={`/app/b/${brandId}/brand/sources`} className="btn btn-primary">Add sources <ArrowRight className="size-4" aria-hidden /></Link>}
                >
                  Import the website and files, then approve the facts. The approved brand shows up here.
                </StateBlock>
              ) : (
                <>
                  {b.sections.map((s) => <SectionBlock key={s.key} brandId={brandId} label={s.label} k={s.key} facts={s.facts} />)}
                  <section aria-labelledby="bk-pal" className="grid gap-3">
                    <h2 id="bk-pal" className="text-lg font-semibold">Palette</h2>
                    {b.palette.colours.length ? (
                      <ul className="flex flex-wrap gap-3">
                        {b.palette.colours.map((c) => (
                          <li key={c.id} className="grid w-28 gap-1.5">
                            <div className="h-14 rounded-md border border-line" style={{ backgroundColor: c.hex }} role="img" aria-label={`Swatch ${c.hex}`} />
                            <span className="num font-mono text-sm uppercase">{c.hex}</span>
                            <span className="text-xs text-muted">{c.role ?? 'no role'}</span>
                          </li>
                        ))}
                      </ul>
                    ) : <p className="text-sm text-muted">No colours yet. <Link className="text-action underline" href={`/app/b/${brandId}/brand/visual`}>Set the palette</Link>.</p>}
                  </section>
                  <section aria-labelledby="bk-comp" className="grid gap-3">
                    <h2 id="bk-comp" className="text-lg font-semibold">Competitors</h2>
                    {b.competitors.length ? (
                      <ul className="grid gap-1.5">
                        {b.competitors.map((c) => <li key={c.id} className="break-words"><span className="font-medium">{c.name}</span> <span className="text-sm text-muted">{c.kind}{c.site ? ` · ${c.site}` : ''}</span></li>)}
                      </ul>
                    ) : <p className="text-sm text-muted">None yet. <Link className="text-action underline" href={`/app/b/${brandId}/brand/review?section=competitors`}>Add competitors</Link>.</p>}
                  </section>
                </>
              )}
            </div>
          );
        }}
      </Loaded>
    </>
  );
}

function ReadinessCard({ r }: { r: Readiness }) {
  return (
    <section aria-labelledby="rd" className="grid gap-5">
      {r.gates.length ? (
        <div role="alert" className="grid gap-2 rounded-lg border-2 border-danger/50 bg-panel p-4">
          <p className="flex items-center gap-2 font-semibold text-danger"><ShieldAlert className="size-5" aria-hidden /> Fix these first</p>
          <ul aria-label="Gates" className="grid gap-1.5">
            {r.gates.map((g) => (
              <li key={g.label} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>{g.label}</span>
                <Link href={g.fixPath} className="text-sm font-medium text-action underline">Fix this</Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="panel grid gap-6 p-5 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="grid gap-1">
            <h2 id="rd" className="text-lg font-semibold">Readiness</h2>
            <p className="text-sm text-muted">Out of 100. The last 30 points come as Publish, Results and Leads arrive.</p>
          </div>
          <p className="flex items-baseline gap-3">
            <span className="num text-5xl leading-none font-semibold" aria-label={`Score ${r.score} out of 100`}>{r.score}</span>
            <span className="text-lg font-semibold text-muted">{BAND[r.band]}</span>
          </p>
        </div>
        <ul aria-label="Dimensions" className="grid gap-5">
          {r.dimensions.map((d) => {
            return (
              <li key={d.key} className="grid gap-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-semibold">{d.label}</h3>
                  <span className="num text-sm text-muted">{Math.round(d.earned * 10) / 10} of {d.weight}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-line" aria-hidden>
                  <div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(100, (d.earned / d.weight) * 100)}%` }} />
                </div>
                {d.note ? <p className="flex items-center gap-1.5 text-sm text-muted"><CircleDashed className="size-3.5" aria-hidden /> {d.note}</p> : null}
                {d.criteria.length ? (
                  <ul className="grid gap-1 text-sm">
                    {d.criteria.map((c) => (
                      <li key={c.label} className="flex flex-wrap items-center gap-x-3">
                        {c.pass ? <Check className="size-4 text-success" aria-label="Done" /> : <CircleDashed className="size-4 text-muted" aria-label="Missing" />}
                        <span className={c.pass ? 'text-muted' : ''}>{c.label}</span>
                        {!c.pass ? <Link href={c.fixPath} className="font-medium text-action underline">Fix<span className="sr-only"> {c.label}</span></Link> : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

function SectionBlock({ brandId, label, k, facts }: { brandId: string; label: string; k: string; facts: Fact[] }) {
  const groups = [...new Set(facts.map((f) => f.subjectId ?? ''))].map((sid) => ({ sid, name: facts.find((f) => (f.subjectId ?? '') === sid)?.subjectName ?? null, facts: facts.filter((f) => (f.subjectId ?? '') === sid) }));
  return (
    <section aria-label={label} className="grid gap-3">
      <h2 className="text-lg font-semibold">{label}</h2>
      {facts.length ? (
        groups.map((g) => (
          <div key={g.sid} className="panel grid gap-3 p-4">
            {g.name ? <h3 className="font-semibold break-words">{g.name}</h3> : null}
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[minmax(9rem,12rem)_minmax(0,1fr)]">
              {g.facts.map((f) => (
                <div key={f.id} className="contents">
                  <dt className="text-sm text-muted">{f.fieldLabel}</dt>
                  <dd><Value value={f.value} unit={f.unit} lang={f.language} /></dd>
                </div>
              ))}
            </dl>
          </div>
        ))
      ) : (
        <p className="text-sm text-muted">Nothing approved yet. <Link className="text-action underline" href={`/app/b/${brandId}/brand/review?section=${k}`}>Review {label.toLowerCase()}</Link>.</p>
      )}
    </section>
  );
}
