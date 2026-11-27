'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { PageHeader, useBrandId } from '@/components/app';
import { api, unwrap } from '@/lib/api/client';
import { Async, MutationError, useAct } from './lib';

export function SettingsView() {
  const brandId = useBrandId()!;
  const q = useQuery({
    queryKey: ['approve', brandId, 'settings'],
    queryFn: () => unwrap(api.GET('/api/brands/{brandId}/approve/settings', { params: { path: { brandId } } })),
  });
  return (
    <>
      <Link href={`/app/b/${brandId}/approve`} className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" aria-hidden />Back to the queue</Link>
      <PageHeader title="Approve settings" description="Who approves, and how long an approval stays valid before it has to be given again." />
      <Async q={q} what="the settings">{(s) => <Form brandId={brandId} approvers={s.approvers} days={s.maxAgeDays} />}</Async>
    </>
  );
}

function Form({ brandId, approvers, days }: { brandId: string; approvers: string[]; days: number }) {
  const [names, setNames] = useState(approvers.join('\n'));
  const [maxAgeDays, setDays] = useState(days);
  const [saved, setSaved] = useState(false);
  useEffect(() => setSaved(false), [names, maxAgeDays]);
  const list = names.split('\n').map((n) => n.trim()).filter(Boolean);
  const invalid = !Number.isInteger(maxAgeDays) || maxAgeDays < 1 || maxAgeDays > 90 || list.length > 20 || list.some((n) => n.length > 100);
  const save = useAct(brandId, () => unwrap(api.PUT('/api/brands/{brandId}/approve/settings', { params: { path: { brandId } }, body: { maxAgeDays, approvers: list } })));
  return (
    <form className="grid max-w-xl gap-6" onSubmit={(e) => { e.preventDefault(); if (!invalid) save.mutate(undefined, { onSuccess: () => setSaved(true) }); }}>
      <div className="field">
        <label className="label" htmlFor="approvers">Approvers</label>
        <textarea id="approvers" className="input h-auto min-h-28 py-2" value={names} onChange={(e) => setNames(e.target.value)} />
        <p className="hint">One name on each line, up to 20.</p>
      </div>
      <div className="field">
        <label className="label" htmlFor="days">Days an approval stays valid</label>
        <input id="days" type="number" min={1} max={90} step={1} className="input !w-28" value={Number.isNaN(maxAgeDays) ? '' : maxAgeDays} onChange={(e) => setDays(e.target.valueAsNumber)} />
        <p className="hint">1 to 90. A cited fact or a licence that runs out sooner ends it sooner.</p>
      </div>
      <MutationError error={save.error} />
      <div className="flex items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={invalid || save.isPending}>Save settings</button>
        {saved ? <p role="status" className="text-sm text-muted">Saved.</p> : null}
      </div>
    </form>
  );
}
