'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { PageHeader, StateBlock, useBrandId } from '@/components/app';
import { api, ApiError, unwrap, type Schemas } from '@/lib/api/client';
import { addDays, Async, dayKey, JobBadge, MutationError, PLATFORM, timeLabel, useAct, useJobs, useSchedulable, wallToIso } from './lib';

type Schedulable = Schemas['PublishSchedulable'];
type Draft = Schedulable['drafts'][number];

export function Calendar() {
  const brandId = useBrandId()!;
  const q = useSchedulable(brandId);
  return (
    <>
      <PageHeader title="Calendar" description="A week of posts in your brand’s timezone, and the approved drafts waiting for a time." />
      <Async q={q} what="calendar">{(s) => <Week brandId={brandId} s={s} />}</Async>
    </>
  );
}

function Week({ brandId, s }: { brandId: string; s: Schedulable }) {
  const tz = s.timezone;
  const [start, setStart] = useState(() => dayKey(new Date(), tz));
  const jobs = useJobs(brandId, wallToIso(start, '00:00', tz), wallToIso(addDays(start, 7), '00:00', tz), true);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const label = (d: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${d}T00:00:00Z`)).replace(',', '');
  return (
    <div className="grid gap-10">
      <section aria-labelledby="wk-h" className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="wk-h" className="mr-auto text-xl font-semibold">{label(days[0]!)} to {label(days[6]!)} <span className="text-base font-normal text-muted">{tz}</span></h2>
          <button type="button" className="btn btn-secondary" aria-label="Previous week" onClick={() => setStart(addDays(start, -7))}><ChevronLeft className="size-4" aria-hidden /></button>
          <button type="button" className="btn btn-secondary" onClick={() => setStart(dayKey(new Date(), tz))}>This week</button>
          <button type="button" className="btn btn-secondary" aria-label="Next week" onClick={() => setStart(addDays(start, 7))}><ChevronRight className="size-4" aria-hidden /></button>
        </div>
        <Async q={jobs} what="week">
          {(l) => (
            <ol className="grid gap-2 md:grid-cols-7">
              {days.map((d) => {
                const here = l.jobs.filter((j) => dayKey(j.scheduledAt, tz) === d);
                return (
                  <li key={d} aria-label={label(d)} className="panel grid content-start gap-2 p-2.5 md:min-h-32">
                    <h3 className="text-sm font-semibold">{label(d)}</h3>
                    {here.length ? (
                      <ul className="grid gap-2">
                        {here.map((j) => (
                          <li key={j.id} className="grid gap-1 rounded-md border border-line p-2 text-sm" data-job-state={j.state}>
                            <Link href={`/app/b/${brandId}/publish/jobs/${j.id}`} className="font-medium underline">
                              <span className="num">{timeLabel(j.scheduledAt, tz)}</span> {j.channel ? PLATFORM[j.channel.platform] : 'Channel removed'}
                            </Link>
                            <JobBadge state={j.state} />
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-muted">Nothing scheduled</p>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </Async>
      </section>
      <section aria-labelledby="dr-h" className="grid gap-3">
        <h2 id="dr-h" className="text-xl font-semibold">Approved drafts ready to schedule</h2>
        {s.drafts.length ? (
          <ul className="grid gap-4">{s.drafts.map((d) => <DraftCard key={d.draftId} brandId={brandId} d={d} s={s} />)}</ul>
        ) : (
          <StateBlock state="empty" title="No approved drafts are waiting">A draft shows up here once it is ready and approved. Approve one in Studio or Approve, then come back to give it a time.</StateBlock>
        )}
      </section>
    </div>
  );
}

function DraftCard({ brandId, d, s }: { brandId: string; d: Draft; s: Schedulable }) {
  const tz = s.timezone;
  const pad = (n: number) => String(n).padStart(2, '0');
  const [date, setDate] = useState(d.day);
  const [time, setTime] = useState(`${pad(s.settings.windowStart)}:00`);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<{ id: string; ok: boolean; text: string }[]>([]);
  const id = `d-${d.draftId}`;
  const book = useAct(brandId, async () => {
    const out = await Promise.all(
      [...picked].map(async (channelId) => {
        const c = d.channels.find((x) => x.channelId === channelId)!;
        const name = `${PLATFORM[c.platform]} · ${c.accountName}`;
        try {
          await unwrap(api.POST('/api/brands/{brandId}/publish/jobs', { params: { path: { brandId } }, body: { draftId: d.draftId, channelId, scheduledAt: wallToIso(date, time, tz) } }));
          return { id: channelId, ok: true, text: `${name}: scheduled` };
        } catch (e) {
          return { id: channelId, ok: false, text: `${name}: ${e instanceof ApiError ? e.message : 'could not be scheduled'}` };
        }
      }),
    );
    setResults(out);
    setPicked(new Set(out.filter((o) => !o.ok).map((o) => o.id)));
  });
  const toggle = (c: string) => setPicked((p) => { const n = new Set(p); if (n.has(c)) n.delete(c); else n.add(c); return n; });
  return (
    <li className="panel grid gap-4 p-4 md:grid-cols-[8rem_minmax(0,1fr)]">
      {d.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={d.thumbnailUrl} alt={`First image of the ${d.kind} draft`} className="max-h-40 w-auto max-w-32 rounded-md object-contain" />
      ) : (
        <div className="grid h-24 place-items-center rounded-md bg-[color-mix(in_oklab,var(--theme-ink)_6%,transparent)] text-sm text-muted">No image</div>
      )}
      <form className="grid min-w-0 gap-4" onSubmit={(e) => { e.preventDefault(); book.mutate(); }}>
        <div className="grid gap-1">
          <p className="text-sm text-muted">{d.kind} · planned for {d.day} on {d.plannedChannel}</p>
          <p className="break-words">{d.excerpt}</p>
        </div>
        <fieldset className="grid gap-2">
          <legend className="label pb-1">Post to</legend>
          {d.channels.length ? d.channels.map((c) => (
            <div key={c.channelId} className="grid gap-0.5">
              <label className={`flex items-center gap-2.5 ${c.fits ? '' : 'text-muted'}`}>
                <input type="checkbox" className="size-4" disabled={!c.fits} checked={picked.has(c.channelId)} onChange={() => toggle(c.channelId)} aria-describedby={c.fits ? undefined : `${id}-${c.channelId}`} />
                {PLATFORM[c.platform]} · {c.accountName}
              </label>
              {!c.fits ? <p id={`${id}-${c.channelId}`} className="pl-6.5 text-sm text-danger">Does not fit: {c.reason ?? 'not available'}</p> : null}
            </div>
          )) : <p className="text-sm text-muted">There are no channels yet. <Link href={`/app/b/${brandId}/publish/channels`} className="underline">Add one</Link>.</p>}
        </fieldset>
        <div className="grid grid-cols-2 gap-3 sm:max-w-md">
          <div className="field"><label htmlFor={`${id}-day`} className="label">Day</label><input id={`${id}-day`} type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} required /></div>
          <div className="field"><label htmlFor={`${id}-time`} className="label">Time</label><input id={`${id}-time`} type="time" className="input" value={time} onChange={(e) => setTime(e.target.value)} required /></div>
        </div>
        <p className="text-sm text-muted">Times are in {tz}. Posts go out between {pad(s.settings.windowStart)}:00 and {pad(s.settings.windowEnd)}:00 there.</p>
        <div><button type="submit" className="btn btn-primary" disabled={!picked.size || book.isPending}>{book.isPending ? 'Scheduling…' : `Schedule to ${picked.size || ''} ${picked.size === 1 ? 'channel' : 'channels'}`.replace('  ', ' ')}</button></div>
        {results.length ? <ul aria-label="Scheduling results" role="status" className="grid gap-1 text-sm">{results.map((r) => <li key={r.id} className={r.ok ? 'text-success' : 'text-danger'}>{r.text}</li>)}</ul> : null}
        <MutationError error={book.error} />
      </form>
    </li>
  );
}
