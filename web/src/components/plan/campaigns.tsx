'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Async, MutationError, PageHeader, StateBlock, useBrandId } from '@/components/app';
import { api, unwrap, type Schemas } from '@/lib/api/client';
import { CampaignRow } from './overview';
import { OBJECTIVES, useAct, useCampaigns } from './lib';
import { label } from '@/lib/labels';

export function Campaigns() {
  const brandId = useBrandId()!;
  const q = useCampaigns(brandId);
  const params = useSearchParams();
  const opportunityId = params.get('opportunity') ?? undefined;
  return (
    <>
      <PageHeader title="Campaigns" description="A campaign is a goal with dates, an audience and a brief. Weeks draw on the campaigns whose brief you approved." />
      <div className="grid items-start gap-x-10 gap-y-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-labelledby="list-h" className="grid gap-3">
          <h2 id="list-h" className="text-xl font-semibold">All campaigns</h2>
          <Async q={q} what="campaigns">
            {(list) =>
              list.length === 0 ? (
                <StateBlock state="empty" title="No campaigns yet">Start one with the form, or from an accepted opportunity on the overview.</StateBlock>
              ) : (
                <ul className="panel divide-y divide-line">{list.map((c) => <CampaignRow key={c.id} c={c} href={`/app/b/${brandId}/plan/campaigns/${c.id}`} />)}</ul>
              )
            }
          </Async>
        </section>
        <CreateForm brandId={brandId} opportunityId={opportunityId} initialName={params.get('name') ?? ''} />
      </div>
    </>
  );
}

function CreateForm({ brandId, opportunityId, initialName }: { brandId: string; opportunityId?: string; initialName: string }) {
  const router = useRouter();
  const [v, setV] = useState({ name: initialName, objective: 'awareness' as Schemas['PlanObjective'], startsOn: '', endsOn: '', budgetNpr: '' });
  const create = useAct(brandId, () =>
    unwrap(api.POST('/api/brands/{brandId}/plan/campaigns', {
      params: { path: { brandId } },
      body: { name: v.name.trim(), objective: v.objective, startsOn: v.startsOn || undefined, endsOn: v.endsOn || undefined, budgetNpr: v.budgetNpr || undefined, opportunityId },
    })),
  );
  const bad = v.startsOn && v.endsOn && v.endsOn < v.startsOn;
  return (
    <form
      aria-label="New campaign"
      className="panel grid gap-4 p-5"
      onSubmit={(e) => { e.preventDefault(); create.mutate(undefined, { onSuccess: (c) => router.push(`/app/b/${brandId}/plan/campaigns/${c.id}`) }); }}
    >
      <h2 className="text-xl font-semibold">New campaign</h2>
      {opportunityId ? <p className="text-sm text-muted">Starting from an accepted opportunity.</p> : null}
      <div className="field"><label htmlFor="c-name" className="label">Name</label>
        <input id="c-name" className="input" required maxLength={200} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></div>
      <div className="field"><label htmlFor="c-obj" className="label">Objective</label>
        <select id="c-obj" className="input" value={v.objective} onChange={(e) => setV({ ...v, objective: e.target.value as typeof v.objective })}>{OBJECTIVES.map((o) => <option key={o} value={o}>{label(o)}</option>)}</select></div>
      <div className="grid grid-cols-2 gap-3">
        <div className="field"><label htmlFor="c-start" className="label">Starts</label>
          <input id="c-start" type="date" className="input" value={v.startsOn} onChange={(e) => setV({ ...v, startsOn: e.target.value })} /></div>
        <div className="field"><label htmlFor="c-end" className="label">Ends</label>
          <input id="c-end" type="date" className="input" aria-invalid={!!bad} value={v.endsOn} onChange={(e) => setV({ ...v, endsOn: e.target.value })} /></div>
      </div>
      {bad ? <p role="alert" className="text-sm text-danger">The end date is before the start date.</p> : null}
      <div className="field"><label htmlFor="c-budget" className="label">Budget (NPR, optional)</label>
        <input id="c-budget" inputMode="decimal" pattern="\d+(\.\d{1,2})?" className="input" value={v.budgetNpr} onChange={(e) => setV({ ...v, budgetNpr: e.target.value })} /></div>
      <MutationError error={create.error} />
      <button type="submit" className="btn btn-primary justify-self-start" disabled={create.isPending || !v.name.trim() || !!bad}>{create.isPending ? 'Creating…' : 'Create campaign'}</button>
    </form>
  );
}
