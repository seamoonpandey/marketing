'use client';

import { useEffect, useState } from 'react';
import { Async, MutationError, PageHeader, useBrand, useBrandId } from '@/components/app';
import { api, unwrap, type Schemas } from '@/lib/api/client';
import { useAct, useSettings } from './lib';

type S = Schemas['PublishSettings'];
const hour = (h: number) => `${String(h % 24).padStart(2, '0')}:00${h === 24 ? ' (end of day)' : ''}`;

export function Settings() {
  const brandId = useBrandId()!;
  const q = useSettings(brandId);
  const tz = useBrand(brandId).data?.timezone;
  return (
    <>
      <PageHeader title="Publish settings" description="When posts may go out, and how many times a send is tried before it fails." />
      <Async q={q} what="settings">{(s) => <Form brandId={brandId} s={s} tz={tz} />}</Async>
    </>
  );
}

function Form({ brandId, s, tz }: { brandId: string; s: S; tz?: string }) {
  const [start, setStart] = useState(s.windowStart);
  const [end, setEnd] = useState(s.windowEnd);
  const [attempts, setAttempts] = useState(s.maxAttempts);
  const [saved, setSaved] = useState(false);
  useEffect(() => setSaved(false), [start, end, attempts]);
  const invalid = start >= end;
  const save = useAct(brandId, () => unwrap(api.PUT('/api/brands/{brandId}/publish/settings', { params: { path: { brandId } }, body: { windowStart: start, windowEnd: end, maxAttempts: attempts } })));
  const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
  return (
    <form className="grid max-w-xl gap-6" onSubmit={(e) => { e.preventDefault(); if (!invalid) save.mutate(undefined, { onSuccess: () => setSaved(true) }); }}>
      <fieldset className="grid gap-3">
        <legend className="label pb-1">Hours when posts may go out{tz ? <span className="font-normal text-muted"> · {tz}</span> : null}</legend>
        <div className="grid grid-cols-2 gap-3">
          <div className="field">
            <label htmlFor="ws" className="label">From</label>
            <select id="ws" className="input" value={start} onChange={(e) => setStart(+e.target.value)}>{range(0, 23).map((h) => <option key={h} value={h}>{hour(h)}</option>)}</select>
          </div>
          <div className="field">
            <label htmlFor="we" className="label">Until</label>
            <select id="we" className="input" value={end} onChange={(e) => setEnd(+e.target.value)}>{range(1, 24).map((h) => <option key={h} value={h}>{hour(h)}</option>)}</select>
          </div>
        </div>
        <p className="hint">A post can be scheduled from the first time up to, not including, the second, in {tz ?? 'the brand’s timezone'}.</p>
        {invalid ? <p role="alert" className="text-sm text-danger">The hours must start before they end.</p> : null}
      </fieldset>
      <div className="field">
        <label htmlFor="att" className="label">Attempts before a send fails</label>
        <input id="att" type="number" min={1} max={5} step={1} className="input !w-28" value={Number.isNaN(attempts) ? '' : attempts} onChange={(e) => setAttempts(e.target.valueAsNumber)} />
        <p className="hint">1 to 5. Used when a channel has a temporary error; a post by hand is never retried.</p>
      </div>
      <MutationError error={save.error} />
      <div className="flex items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={invalid || !Number.isInteger(attempts) || attempts < 1 || attempts > 5 || save.isPending}>Save settings</button>
        {saved ? <p role="status" className="text-sm text-muted">Saved.</p> : null}
      </div>
    </form>
  );
}
