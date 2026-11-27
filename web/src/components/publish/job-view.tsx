'use client';

import { Check, Copy, Download, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { PageHeader, StateBlock, useBrandId } from '@/components/app';
import { api, unwrap, type Schemas } from '@/lib/api/client';
import { Async, dayKey, jobPath, JobBadge, MutationError, PLATFORM, STATE, Time, timeLabel, useAct, useJob, wallToIso, type Job } from './lib';

type Detail = Schemas['PublishJobDetail'];

const isHttp = (s: string) => /^https?:\/\/\S+$/i.test(s.trim());

export function JobView() {
  const jobId = useParams<{ jobId: string }>().jobId;
  const brandId = useBrandId()!;
  const q = useJob(brandId, jobId);
  return (
    <Async q={q} what="job">
      {(d) => <Body brandId={brandId} d={d} />}
    </Async>
  );
}

function Body({ brandId, d }: { brandId: string; d: Detail }) {
  const { job, timezone: tz } = d;
  const st = STATE[job.state];
  const ch = job.channel;
  const manual = job.actions.confirmManual;
  return (
    <>
      <Link href={`/app/b/${brandId}/publish`} className="mb-3 inline-block text-sm text-muted underline">Back to Publish</Link>
      <PageHeader
        title={manual ? `Post this on ${ch ? PLATFORM[ch.platform] : 'the channel'}` : `${ch ? PLATFORM[ch.platform] : 'Channel removed'} post`}
        description={
          <>
            {ch ? <>{ch.accountName} · </> : null}
            scheduled for <Time iso={job.scheduledAt} tz={tz} />
          </>
        }
        actions={<JobBadge state={job.state} />}
      />
      <div className="grid gap-6 pb-40 lg:grid-cols-[minmax(0,1fr)_22rem] lg:pb-0">
        <div className="grid min-w-0 content-start gap-6">
          <section className="panel grid gap-1 p-4" aria-label="What this state means">
            <p className="font-semibold">{st.meaning}</p>
            {job.error ? <p className="text-danger">{job.error}</p> : null}
            <p className="text-muted">{st.next}</p>
            {job.state === 'unknown' ? <p className="text-muted">It will not be sent again until you say whether it went out. Nothing is retried on its own.</p> : null}
          </section>
          {job.state === 'unknown' ? <Unknown brandId={brandId} job={job} /> : null}
          {manual ? <PackageView d={d} /> : job.externalUrl ? <Published job={job} /> : null}
          <Actions brandId={brandId} job={job} tz={tz} />
        </div>
        <div className="grid min-w-0 content-start gap-6">
          {manual ? <Confirm brandId={brandId} job={job} /> : null}
          <History d={d} />
        </div>
      </div>
    </>
  );
}

// ---- the package: what to post ----------------------------------------------------------------

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // No clipboard permission (an old browser): copy through a hidden field.
      const ta = Object.assign(document.createElement('textarea'), { value: text });
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setDone(true);
    setTimeout(() => setDone(false), 2500);
  }
  return (
    <>
      <button type="button" onClick={copy} aria-label={`Copy ${label}`} className="btn btn-secondary h-12 shrink-0 px-4 text-base">
        {done ? <Check className="size-5" aria-hidden /> : <Copy className="size-5" aria-hidden />}
        {done ? 'Copied' : 'Copy'}
      </button>
      <span role="status" className="sr-only">{done ? `${label} copied` : ''}</span>
    </>
  );
}

function CopyBlock({ label, text, lang }: { label: string; text: string; lang: string }) {
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-3">
        <h4 className="label">{label}</h4>
        <CopyButton text={text} label={label} />
      </div>
      <p lang={lang} data-copy={label} className="rounded-md bg-[color-mix(in_oklab,var(--theme-ink)_5%,transparent)] p-3 break-words whitespace-pre-wrap">{text}</p>
    </div>
  );
}

const langName = (code: string) => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
};

function PackageView({ d }: { d: Detail }) {
  const pkg = d.package;
  if (!pkg.available) {
    return (
      <StateBlock state="error" title="There is nothing to post">
        {pkg.reason ?? 'The approval no longer matches what was scheduled, or the draft is gone.'} Do not post anything from memory; the draft needs approving again.
      </StateBlock>
    );
  }
  return (
    <section aria-labelledby="pkg-h" className="grid gap-5">
      <h2 id="pkg-h" className="text-xl font-semibold">What to post</h2>
      {pkg.captions.map((c) => (
        <div key={c.language} className="panel grid gap-4 p-4" role="group" aria-label={`Text in ${langName(c.language)}`}>
          {pkg.captions.length > 1 ? <h3 className="font-semibold">{langName(c.language)}</h3> : null}
          <CopyBlock label="Caption" text={c.caption} lang={c.language} />
          {c.cta ? <CopyBlock label="Call to action" text={c.cta} lang={c.language} /> : null}
          {c.hashtags.length ? <CopyBlock label="Hashtags" text={c.hashtags.join(' ')} lang={c.language} /> : null}
        </div>
      ))}
      {pkg.media.length ? (
        <div className="grid gap-3">
          <h3 className="font-semibold">{pkg.media.length > 1 ? 'Images and video, in posting order' : pkg.media[0]!.kind === 'video' ? 'Video' : 'Image'}</h3>
          <ul className="grid gap-3 sm:grid-cols-2">
            {pkg.media.map((m) => {
              const size = `${m.width} × ${m.height}`;
              return (
                <li key={m.index} className="panel grid gap-3 p-3">
                  {/* object-contain inside the media's own shape: never cropped or stretched */}
                  <div className="grid place-items-center rounded-md bg-[color-mix(in_oklab,var(--theme-ink)_6%,transparent)]">
                    {m.kind === 'video' ? (
                      <video src={m.url} controls preload="metadata" aria-label={`Video ${m.index + 1}, ${m.ratio}`} className="max-h-72 w-auto max-w-full" style={{ aspectRatio: `${m.width} / ${m.height}` }} />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.url} alt={`Image ${m.index + 1} of the post, ${m.ratio}`} width={m.width} height={m.height} className="max-h-72 w-auto max-w-full object-contain" />
                    )}
                  </div>
                  <a href={m.url} download={m.filename} className="btn btn-secondary h-12 text-base" aria-label={`Download ${m.filename}, ${size} pixels, ${m.ratio}`}>
                    <Download className="size-5" aria-hidden />
                    Download · {m.ratio} · {size}
                  </a>
                  <p className="text-xs break-all text-muted">{m.filename}</p>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <StateBlock state="empty" size="inline" title="This post has no image or video">Post the text on its own.</StateBlock>
      )}
    </section>
  );
}

// ---- confirm and resolve ----------------------------------------------------------------------

function LinkForm({ id, label, submit, pending, error, onSubmit, bare }: { id: string; label: string; submit: string; pending: boolean; error: Error | null; onSubmit: (url: string) => void; bare?: boolean }) {
  const [url, setUrl] = useState('');
  const [bad, setBad] = useState(false);
  function go(e: FormEvent) {
    e.preventDefault();
    if (!isHttp(url)) return setBad(true);
    setBad(false);
    onSubmit(url.trim());
  }
  return (
    <form onSubmit={go} className={`grid gap-3 ${bare ? '' : 'panel p-4'}`} noValidate>
      <div className="field">
        <label htmlFor={id} className="label">{label}</label>
        <input id={id} type="url" inputMode="url" autoComplete="off" className="input h-12" placeholder="https://" value={url} onChange={(e) => { setUrl(e.target.value); setBad(false); }} aria-invalid={bad} aria-describedby={bad ? `${id}-err` : undefined} />
        {bad ? <p id={`${id}-err`} role="alert" className="text-sm text-danger">That is not a link. Paste the post’s address, starting with https://</p> : null}
      </div>
      <button type="submit" className="btn btn-primary h-12 text-base" disabled={pending}>{pending ? 'Saving…' : submit}</button>
      <MutationError error={error} />
    </form>
  );
}

function Confirm({ brandId, job }: { brandId: string; job: Job }) {
  const confirm = useAct(brandId, (url: string) => unwrap(api.POST('/api/brands/{brandId}/publish/jobs/{id}/confirm-manual', { ...jobPath(brandId, job.id), body: { url } })));
  return (
    // On a phone this is pinned to the bottom of the screen, so the link field is always in reach.
    <section aria-labelledby="confirm-h" className="fixed inset-x-0 bottom-0 z-20 border-t border-line-strong bg-bg p-3 shadow-pop lg:static lg:rounded-lg lg:border lg:bg-panel lg:p-4 lg:shadow-none">
      <h2 id="confirm-h" className="sr-only lg:not-sr-only lg:mb-3 lg:text-lg lg:font-semibold">I posted it</h2>
      <LinkForm bare id="post-url" label="Link to your post" submit="Confirm it is posted" pending={confirm.isPending} error={confirm.error} onSubmit={(u) => confirm.mutate(u)} />
    </section>
  );
}

function Unknown({ brandId, job }: { brandId: string; job: Job }) {
  const [mode, setMode] = useState<'posted' | 'not' | null>(null);
  const resolve = useAct(brandId, (v: { posted: boolean; url?: string }) => unwrap(api.POST('/api/brands/{brandId}/publish/jobs/{id}/resolve-unknown', { ...jobPath(brandId, job.id), body: v })));
  if (!job.actions.resolveUnknown) return null;
  return (
    <section aria-labelledby="unk-h" className="panel grid gap-4 p-4">
      <h2 id="unk-h" className="text-lg font-semibold">Did it go out?</h2>
      <p className="text-muted">Look at the channel yourself, then tell the system which it was.</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-secondary" aria-pressed={mode === 'posted'} onClick={() => setMode('posted')}>It was posted</button>
        <button type="button" className="btn btn-secondary" aria-pressed={mode === 'not'} onClick={() => setMode('not')}>It was not posted</button>
      </div>
      {mode === 'posted' ? (
        <LinkForm id="unk-url" label="Link to the post" submit="Save as published" pending={resolve.isPending} error={resolve.error} onSubmit={(url) => resolve.mutate({ posted: true, url })} />
      ) : null}
      {mode === 'not' ? (
        <div className="grid gap-3">
          <p>It will be sent again now. The same key goes with it, so the platform cannot post it twice.</p>
          <div><button type="button" className="btn btn-primary" disabled={resolve.isPending} onClick={() => resolve.mutate({ posted: false })}>Send it again</button></div>
          <MutationError error={resolve.error} />
        </div>
      ) : null}
    </section>
  );
}

function Published({ job }: { job: Job }) {
  return (
    <a href={job.externalUrl!} target="_blank" rel="noreferrer" className="panel flex flex-wrap items-center gap-2 p-4 font-medium text-brand underline">
      Open the post <ExternalLink className="size-4" aria-hidden />
      <span className="text-sm font-normal break-all text-muted">{job.externalUrl}</span>
    </a>
  );
}

// ---- cancel, move, retry ----------------------------------------------------------------------

function Actions({ brandId, job, tz }: { brandId: string; job: Job; tz: string }) {
  const [moving, setMoving] = useState(false);
  const [date, setDate] = useState(() => dayKey(job.scheduledAt, tz));
  const [time, setTime] = useState(() => timeLabel(job.scheduledAt, tz));
  const cancel = useAct(brandId, () => unwrap(api.POST('/api/brands/{brandId}/publish/jobs/{id}/cancel', jobPath(brandId, job.id))));
  const retry = useAct(brandId, () => unwrap(api.POST('/api/brands/{brandId}/publish/jobs/{id}/retry', jobPath(brandId, job.id))));
  const move = useAct(brandId, () => unwrap(api.POST('/api/brands/{brandId}/publish/jobs/{id}/reschedule', { ...jobPath(brandId, job.id), body: { scheduledAt: wallToIso(date, time, tz) } })));
  const a = job.actions;
  if (!a.cancel && !a.reschedule && !a.retry) return null;
  return (
    <section aria-labelledby="act-h" className="grid gap-3">
      <h2 id="act-h" className="text-lg font-semibold">Other actions</h2>
      <div className="flex flex-wrap gap-2">
        {a.retry ? <button type="button" className="btn btn-primary" disabled={retry.isPending} onClick={() => retry.mutate()}>Retry now</button> : null}
        {a.reschedule ? <button type="button" className="btn btn-secondary" aria-expanded={moving} onClick={() => setMoving(!moving)}>Move to another time</button> : null}
        {a.cancel ? <button type="button" className="btn btn-danger" disabled={cancel.isPending} onClick={() => cancel.mutate()}>Cancel this post</button> : null}
      </div>
      {moving ? (
        <form className="panel grid gap-3 p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); move.mutate(); }}>
          <div className="field"><label htmlFor="mv-d" className="label">Day</label><input id="mv-d" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} required /></div>
          <div className="field"><label htmlFor="mv-t" className="label">Time ({tz})</label><input id="mv-t" type="time" className="input" value={time} onChange={(e) => setTime(e.target.value)} required /></div>
          <button type="submit" className="btn btn-primary" disabled={move.isPending}>Move</button>
        </form>
      ) : null}
      <MutationError error={cancel.error ?? retry.error ?? move.error} />
    </section>
  );
}

// ---- history ----------------------------------------------------------------------------------

function History({ d }: { d: Detail }) {
  return (
    <section aria-labelledby="hist-h" className="grid gap-3">
      <h2 id="hist-h" className="text-lg font-semibold">History</h2>
      {d.history.length ? (
        <ol className="grid gap-2">
          {d.history.map((h, i) => (
            <li key={i} className="panel grid gap-0.5 px-3 py-2 text-sm">
              <span className="font-medium">{h.from && h.to ? `${STATE[h.from].label} to ${STATE[h.to].label}` : h.to ? STATE[h.to].label : h.action}</span>
              {h.note ? <span className="break-words text-muted">{h.note}</span> : null}
              <Time iso={h.at} tz={d.timezone} />
            </li>
          ))}
        </ol>
      ) : (
        <StateBlock state="empty" size="inline" title="No history yet" />
      )}
    </section>
  );
}
