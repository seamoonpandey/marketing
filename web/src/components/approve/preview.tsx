'use client';

import { CircleAlert, Clock3, Lock } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Async, BackLink, MutationError, PageHeader, StateBlock, Time, useBrandId } from '@/components/app';
import { api, hasStatus, unwrap, type Schemas } from '@/lib/api/client';
import { cap, fmtDay, Notice, NOTE_MIN, RiskTag, StateTag, useAct, usePreview, type Preview } from './lib';
import { Media } from './media';
import { label, languageName } from '@/lib/labels';
import { formatDateOnly } from '@/lib/time';

type Draft = NonNullable<Preview['draft']>;

export function PreviewScreen() {
  const brandId = useBrandId()!;
  const { draftId } = useParams<{ draftId: string }>();
  const q = usePreview(brandId, draftId);
  const [notice, setNotice] = useState<string | null>(null);
  const hash = q.data?.draft?.payloadHash;
  const seen = useRef<string | null | undefined>(undefined);
  // The content on screen changed under the owner (a refetch brought a new version): say so.
  useEffect(() => {
    if (seen.current !== undefined && seen.current !== hash) setNotice((n) => n ?? 'This draft changed since you opened it.');
    seen.current = hash;
  }, [hash]);
  return (
    <>
      <BackLink href={`/app/b/${brandId}/approve`}>Back to the queue</BackLink>
      <Async q={q} what="preview">
        {(p) => (
          <div className="grid gap-6">
            {notice ? (
              <Notice>
                <p className="font-semibold">{notice} Nothing was approved or rejected.</p>
                <p>The preview below is the new version. Read it again before you decide.</p>
              </Notice>
            ) : null}
            {p.draft ? <Body brandId={brandId} draftId={draftId} p={p} d={p.draft} onChanged={setNotice} onDecided={() => setNotice(null)} /> : (
              <StateBlock state="stale" title="Studio no longer has this draft">It was deleted or is no longer ready. Any approval it had is no longer valid. The decisions already made are kept below.</StateBlock>
            )}
            <History decisions={p.history} />
          </div>
        )}
      </Async>
    </>
  );
}

function Body({ brandId, draftId, p, d, onChanged, onDecided }: { brandId: string; draftId: string; p: Preview; d: Draft; onChanged: (m: string) => void; onDecided: () => void }) {
  const copies = d.content.copies;
  return (
    <>
      <PageHeader
        title={`Approve version ${d.version}`}
        description={
          <>
            Goes out on <strong className="font-semibold text-ink">{label(d.channel)}</strong> on <strong className="font-semibold text-ink">{fmtDay(d.day)}</strong>. {label(d.kind)}{d.pillar ? `, ${label(d.pillar)}` : ''}.
            {p.stateReason ? <span className="mt-1 block text-sm break-words">{p.stateReason}</span> : null}
          </>
        }
        actions={<><StateTag state={p.state} /><RiskTag risk={d.risk} /></>}
      />
      <div className="grid items-start gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="grid gap-8">
          <section aria-labelledby="as-h" className="panel grid gap-5 p-5 sm:p-6">
            <div className="grid gap-1">
              <h2 id="as-h" className="text-xl font-semibold">Exactly as it will appear</h2>
              <p className="text-sm text-muted">This is the whole post: what you see here is what is published under your name.</p>
            </div>
            {d.renders.length > 0 ? <Media d={d} /> : d.kind !== 'post' ? <StateBlock state="partial" size="inline" title="Nothing has been rendered for this version">The images or video are missing, so there is nothing to approve yet.</StateBlock> : null}
            {copies.map((c) => (
              <div key={c.language} lang={c.language} className="grid gap-2 border-t border-line pt-4">
                <p className="text-xs font-semibold tracking-wide text-muted uppercase">Caption · {languageName(c.language)}</p>
                <p className="max-w-[65ch] text-lg leading-relaxed break-words whitespace-pre-wrap">{c.sentences.map((s) => s.text).join(' ')}</p>
                {c.hashtags.length ? <p className="max-w-[65ch] break-words text-brand">{c.hashtags.map((h) => `#${h}`).join(' ')}</p> : null}
                {c.cta ? <p className="max-w-[65ch] break-words"><span className="text-sm text-muted">Call to action: </span><strong className="font-semibold">{c.cta}</strong></p> : null}
              </div>
            ))}
            {copies.length === 0 ? <StateBlock state="empty" size="inline" title="This version has no copy" /> : null}
          </section>
          <Facts d={d} />
          <Findings d={d} />
        </div>
        <Decision key={`${d.version}-${d.payloadHash}`} brandId={brandId} draftId={draftId} p={p} d={d} onChanged={onChanged} onDecided={onDecided} />
      </div>
    </>
  );
}

function Facts({ d }: { d: Draft }) {
  return (
    <section aria-labelledby="facts-h" className="grid gap-3">
      <h2 id="facts-h" className="text-xl font-semibold">Facts it cites</h2>
      {d.facts.length === 0 && d.missingFactIds.length === 0 ? <StateBlock state="empty" size="inline" title="It cites no facts" /> : (
        <ul aria-label="Cited facts" className="panel divide-y divide-line">
          {d.facts.map((f) => (
            <li key={f.id} className="grid gap-0.5 px-4 py-3">
              <span className="font-medium break-words">{f.subjectName ? `${f.subjectName}: ` : ''}{f.field} = {typeof f.value === 'string' || typeof f.value === 'number' ? String(f.value) : JSON.stringify(f.value)}{f.unit ? ` ${f.unit}` : ''}</span>
              <span className="text-sm text-muted">{label(f.section)} · approved{f.expiresAt ? `, valid until ${formatDateOnly(f.expiresAt)}` : ''}</span>
            </li>
          ))}
          {d.missingFactIds.map((id) => <li key={id} className="px-4 py-3 text-sm text-danger">A cited fact ({id}) is not approved today.</li>)}
        </ul>
      )}
      {d.leftOut.length > 0 ? (
        <div className="grid gap-2">
          <h3 className="font-semibold">Left out of this version</h3>
          <ul aria-label="Left out" className="grid gap-1 text-sm">
            {d.leftOut.map((l, i) => <li key={i} lang={l.language} className="break-words">{l.text} <span className="text-muted">({languageName(l.language)}, {l.reason})</span></li>)}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function Findings({ d }: { d: Draft }) {
  if (d.findings.length === 0) return null;
  return (
    <section aria-labelledby="find-h" className="grid gap-3">
      <h2 id="find-h" className="text-xl font-semibold">Checks</h2>
      <ul className="panel divide-y divide-line">
        {d.findings.map((f, i) => (
          <li key={i} className="flex items-start gap-3 px-4 py-3">
            <CircleAlert className={`mt-0.5 size-4 shrink-0 ${f.blocking ? 'text-danger' : 'text-muted'}`} aria-hidden />
            <span className="break-words"><strong className="font-semibold">{f.blocking ? 'Blocks approval' : 'Note'}</strong> · {f.where}: {f.message}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---- the decision --------------------------------------------------------------------------------

type Sent = Schemas['ApproveApprove'] | Schemas['ApproveReject'];

function Decision({ brandId, draftId, p, d, onChanged, onDecided }: { brandId: string; draftId: string; p: Preview; d: Draft; onChanged: (m: string) => void; onDecided: () => void }) {
  const [note, setNote] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const act = useAct(brandId, async (v: { to: 'approve' | 'reject'; body: Sent }): Promise<Preview> =>
    unwrap(api.POST(`/api/brands/{brandId}/approve/queue/{draftId}/${v.to}`, { params: { path: { brandId, draftId } }, body: v.body as never })) as Promise<Preview>,
  );
  const hash = d.payloadHash;
  const noteOk = !d.noteRequired || note.trim().length >= NOTE_MIN;
  const send = (to: 'approve' | 'reject', body: Sent) =>
    act.mutate({ to, body }, {
      onSuccess: () => { setRejecting(false); onDecided(); },
      // Never retried: a refused decision reloads the preview (onSettled) and asks for another look.
      onError: (e) => { if (hasStatus(e, 409)) onChanged(e.code === 'changed' ? 'This draft changed since you opened it.' : `Not done: ${e.message}.`); },
    });
  const conflict = hasStatus(act.error, 409);
  const first = p.state === 'waiting';
  // A lapsed (expired or no longer valid) or rejected version the server would take a new approval for.
  const again = !first && (p.state === 'expired' || p.state === 'invalid' || p.state === 'rejected') && d.canApprove;
  const withdrawable = (p.state === 'approved' || p.state === 'paused') && d.canReject;

  if (!hash || (!first && !again)) {
    return (
      <aside aria-label="Decision" className="panel grid gap-3 p-5 lg:sticky lg:top-6">
        <h2 className="text-lg font-semibold">{p.state === 'approved' || p.state === 'paused' ? 'You approved this version' : p.state === 'rejected' ? 'You rejected this version' : 'No decision to make'}</h2>
        <StateTag state={p.state} />
        <p className="text-sm break-words text-muted">{p.stateReason ?? (p.state === 'approved' ? 'Valid until the approval runs out or something it depends on changes.' : 'A decision is recorded once for each version.')}</p>
        <p className="flex items-start gap-2 text-sm"><Lock className="mt-0.5 size-4 shrink-0" aria-hidden />Any later edit makes a new version. It comes back for a new decision, and this approval stops counting.</p>
        {withdrawable && hash ? (
          <div className="grid gap-3 border-t border-line pt-4">
            {rejecting ? (
              <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (reason.trim()) send('reject', { payloadHash: hash, reason: reason.trim() }); }}>
                <div className="field">
                  <label className="label" htmlFor="withdraw-reason">Why are you withdrawing it? (required)</label>
                  <textarea id="withdraw-reason" className="input h-auto min-h-20 py-2" maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
                  <p className="hint">The approval ends now. You can approve this version again afterwards.</p>
                </div>
                <MutationError error={conflict ? null : act.error} />
                <div className="flex gap-2">
                  <button type="submit" className="btn btn-secondary" disabled={!reason.trim() || act.isPending}>Withdraw approval</button>
                  <button type="button" className="btn btn-quiet" onClick={() => setRejecting(false)}>Cancel</button>
                </div>
              </form>
            ) : (
              <button type="button" className="btn btn-secondary justify-self-start" onClick={() => setRejecting(true)}>Withdraw approval…</button>
            )}
          </div>
        ) : null}
      </aside>
    );
  }
  const label = first ? `Approve version ${d.version}` : 'Approve again';
  return (
    <aside aria-label="Decision" className="panel grid gap-5 p-5 lg:sticky lg:top-6">
      <div className="grid gap-2">
        <h2 className="text-lg font-semibold">{first ? 'Your decision' : p.state === 'rejected' ? 'You rejected this version' : 'This approval no longer counts'}</h2>
        {!first ? <p className="text-sm break-words text-muted">{p.stateReason ?? (p.state === 'rejected' ? 'You can still approve this same version.' : null)}</p> : null}
        {!first ? <p className="text-sm">The same version can be approved again. Every check runs again, on what is shown here.</p> : null}
        <p>You are approving <strong className="font-semibold">version {d.version}</strong>, exactly as shown. <span className="text-muted">Fingerprint <code className="font-mono text-xs">{hash.slice(0, 10)}</code></span></p>
        <p className="flex items-start gap-2 text-sm"><Lock className="mt-0.5 size-4 shrink-0" aria-hidden />If anyone edits this draft afterwards, your approval is undone and it returns here to be approved again.</p>
        {d.expiresIfApproved ? <p className="flex items-start gap-2 text-sm text-muted"><Clock3 className="mt-0.5 size-4 shrink-0" aria-hidden />An approval given now is valid until <Time iso={d.expiresIfApproved} year />.</p> : null}
      </div>
      <div className="grid gap-1.5">
        <RiskTag risk={d.risk} />
        {d.riskReasons.length ? <ul aria-label="Why this risk" className="list-disc pl-5 text-sm break-words">{d.riskReasons.map((r) => <li key={r}>{r}</li>)}</ul> : null}
      </div>
      {d.noteRequired ? (
        <div className="field">
          <label className="label" htmlFor="note">Review note (required, at least {NOTE_MIN} characters)</label>
          <textarea id="note" className="input h-auto min-h-24 py-2" maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} aria-describedby="note-count" />
          <p id="note-count" className="hint num" aria-live="polite">
            {note.trim().length >= NOTE_MIN ? 'Note is long enough.' : `${NOTE_MIN - note.trim().length} more character${NOTE_MIN - note.trim().length === 1 ? '' : 's'} needed.`}
          </p>
        </div>
      ) : null}
      <div className="grid gap-2">
        <button type="button" className="btn btn-primary h-11 text-base" disabled={!d.canApprove || !noteOk || act.isPending}
          onClick={() => send('approve', { payloadHash: hash, ...(d.noteRequired ? { reviewNote: note.trim() } : {}) })}>
          {label}
        </button>
        {!d.canApprove && d.cannotApproveReason ? <p className="text-sm break-words text-danger">{d.cannotApproveReason}</p> : null}
        {d.canApprove && !noteOk ? <p className="text-sm text-muted">Write the review note to approve.</p> : null}
        {conflict ? null : <MutationError error={act.error} />}
      </div>
      {first ? (
        <div className="grid gap-3 border-t border-line pt-4">
          {rejecting ? (
            <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (reason.trim()) send('reject', { payloadHash: hash, reason: reason.trim() }); }}>
              <div className="field">
                <label className="label" htmlFor="reason">Why are you rejecting it? (required)</label>
                <textarea id="reason" className="input h-auto min-h-20 py-2" maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
              </div>
              <div className="flex gap-2">
                <button type="submit" className="btn btn-danger" disabled={!d.canReject || !reason.trim() || act.isPending}>Send rejection</button>
                <button type="button" className="btn btn-quiet" onClick={() => setRejecting(false)}>Cancel</button>
              </div>
              {!d.canReject && d.cannotRejectReason ? <p className="text-sm text-danger">{d.cannotRejectReason}</p> : null}
            </form>
          ) : (
            <button type="button" className="btn btn-quiet justify-self-start text-muted" onClick={() => setRejecting(true)}>Reject this version…</button>
          )}
        </div>
      ) : null}
    </aside>
  );
}

function History({ decisions }: { decisions: Preview['history'] }) {
  return (
    <section aria-labelledby="hist-h" className="grid gap-3">
      <h2 id="hist-h" className="text-xl font-semibold">Decision history</h2>
      {decisions.length === 0 ? <StateBlock state="empty" size="inline" title="No decision has been made on this draft" /> : (
        <ol className="panel divide-y divide-line">
          {decisions.map((h) => (
            <li key={h.id} className="grid gap-1 px-4 py-3">
              <p className="font-medium"><span className={h.decision === 'approved' ? 'text-success' : 'text-ink'}>{cap(h.decision)}</span> version {h.version} by {h.decidedBy}<span className="font-normal text-muted"> · <Time iso={h.decidedAt} year /></span></p>
              {h.reason ? <p className="text-sm break-words">Reason: {h.reason}</p> : null}
              {h.reviewNote ? <p className="text-sm break-words">Review note: {h.reviewNote}</p> : null}
              <p className="text-sm text-muted">{cap(h.risk)} risk{h.expiresAt ? <> · valid until <Time iso={h.expiresAt} year /></> : null}{h.bulkId ? ' · approved in bulk' : ''}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
