'use client';

import { useEffect, useRef, useState } from 'react';
import { api, unwrap, type Schemas } from '@/lib/api/client';
import { CHANNELS, FORMATS, FUNNELS, INTENTS, PILLARS, factText, fmt, label, MutationError, useAct, type Campaign, type Item, type Week } from './lib';

type Plan = Schemas['PlanWeekPlan'];
type Props = {
  brandId: string;
  week: Week;
  days: string[];
  campaigns: Campaign[];
  editing: { item: Item } | { day: string };
  onClose: () => void;
  onSaved: (planStatus: Plan['status']) => void;
};

const SELECTS = [
  ['format', 'Format', FORMATS],
  ['pillar', 'Pillar', PILLARS],
  ['funnel', 'Funnel stage', FUNNELS],
  ['intent', 'Intent', INTENTS],
] as const;

/** Add or edit one idea in a native dialog: Escape closes it, focus is trapped, and it returns to the opener. */
export function ItemDialog({ brandId, week, days, campaigns, editing, onClose, onSaved }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  const item = 'item' in editing ? editing.item : null;
  const [v, setV] = useState({
    day: item?.day ?? ('day' in editing ? editing.day : days[0]!),
    channel: item?.channel ?? 'facebook',
    format: item?.format ?? '', pillar: item?.pillar ?? '', funnel: item?.funnel ?? '', intent: item?.intent ?? '',
    campaignId: item?.campaignId ?? '', idea: item?.idea ?? '', cta: item?.cta ?? '', factIds: item?.factIds ?? [],
  });
  const set = (k: keyof typeof v, x: string) => setV({ ...v, [k]: x });

  const save = useAct(brandId, async () => {
    const orNull = (s: string) => s || null;
    const r = item
      ? await unwrap(api.PATCH('/api/brands/{brandId}/plan/items/{id}', {
          params: { path: { brandId, id: item.id } },
          body: { day: v.day, channel: v.channel as Item['channel'], format: orNull(v.format) as Item['format'], pillar: orNull(v.pillar) as Item['pillar'], funnel: orNull(v.funnel) as Item['funnel'], intent: orNull(v.intent) as Item['intent'], campaignId: orNull(v.campaignId), idea: v.idea, cta: v.cta, factIds: v.factIds },
        }))
      : await unwrap(api.POST('/api/brands/{brandId}/plan/weeks/{weekStart}/items', {
          params: { path: { brandId, weekStart: week.weekStart } },
          body: { day: v.day, channel: v.channel as Item['channel'], format: (v.format || undefined) as NonNullable<Item['format']> | undefined, pillar: (v.pillar || undefined) as NonNullable<Item['pillar']> | undefined, funnel: (v.funnel || undefined) as NonNullable<Item['funnel']> | undefined, intent: (v.intent || undefined) as NonNullable<Item['intent']> | undefined, campaignId: v.campaignId || undefined, idea: v.idea, cta: v.cta, factIds: v.factIds },
        }));
    return r.plan;
  });
  const remove = useAct(brandId, async () => (await unwrap(api.DELETE('/api/brands/{brandId}/plan/items/{id}', { params: { path: { brandId, id: item!.id } } }))).plan);
  const done = (plan: Plan) => { onSaved(plan.status); onClose(); };
  const options = (list: readonly string[]) => list.map((o) => <option key={o} value={o}>{label(o)}</option>);

  return (
    <dialog
      ref={ref}
      aria-labelledby="item-h"
      onClose={onClose}
      className="m-auto max-h-[92dvh] w-[min(42rem,calc(100vw-2rem))] overflow-auto rounded-lg border border-line bg-panel p-0 text-ink shadow-pop backdrop:bg-[color-mix(in_oklab,var(--theme-ink)_40%,transparent)]"
    >
      <form className="grid gap-4 p-5 sm:p-6" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined, { onSuccess: done }); }}>
        <h2 id="item-h" className="text-lg font-semibold">{item ? 'Edit this idea' : 'Add an idea'}</h2>
        {item && week.plan?.status === 'approved' ? <p className="text-sm text-muted">This week is approved. Saving a change sets it back to draft.</p> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="field"><label htmlFor="it-day" className="label">Day</label>
            <select id="it-day" className="input" value={v.day} onChange={(e) => set('day', e.target.value)}>{days.map((d) => <option key={d} value={d}>{fmt(d, { weekday: 'long', day: 'numeric', month: 'short' })}</option>)}</select></div>
          <div className="field"><label htmlFor="it-channel" className="label">Channel</label>
            <select id="it-channel" className="input" value={v.channel} onChange={(e) => set('channel', e.target.value)}>{options(CHANNELS)}</select></div>
          {SELECTS.map(([k, name, list]) => (
            <div className="field" key={k}><label htmlFor={`it-${k}`} className="label">{name}</label>
              <select id={`it-${k}`} className="input" value={v[k]} onChange={(e) => set(k, e.target.value)}><option value="">Not set</option>{options(list)}</select></div>
          ))}
          <div className="field sm:col-span-2"><label htmlFor="it-campaign" className="label">Campaign</label>
            <select id="it-campaign" className="input" value={v.campaignId} onChange={(e) => set('campaignId', e.target.value)}><option value="">None</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        </div>
        <div className="field"><label htmlFor="it-idea" className="label">Idea</label>
          <textarea id="it-idea" rows={3} maxLength={2000} className="input h-auto py-2 leading-relaxed" value={v.idea} onChange={(e) => set('idea', e.target.value)} /></div>
        <div className="field"><label htmlFor="it-cta" className="label">Call to action</label>
          <input id="it-cta" maxLength={500} className="input" value={v.cta} onChange={(e) => set('cta', e.target.value)} /></div>
        {week.facts.length > 0 ? (
          <fieldset className="grid gap-2">
            <legend className="label">Approved facts this idea relies on</legend>
            <div className="grid max-h-40 gap-1.5 overflow-auto rounded-md border border-line p-3">
              {week.facts.map((f) => (
                <label key={f.id} className="flex items-start gap-2.5 text-sm">
                  <input type="checkbox" className="mt-0.5 size-4 shrink-0" checked={v.factIds.includes(f.id)} onChange={(e) => setV({ ...v, factIds: e.target.checked ? [...v.factIds, f.id] : v.factIds.filter((x) => x !== f.id) })} />
                  <span className="break-words">{factText(f)}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        <MutationError error={save.error ?? remove.error} />
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className="btn btn-primary" disabled={save.isPending}>{save.isPending ? 'Saving…' : item ? 'Save changes' : 'Add idea'}</button>
          <button type="button" className="btn btn-quiet" onClick={() => ref.current?.close()}>Cancel</button>
          {item ? (
            <button type="button" className="btn btn-danger ml-auto" disabled={remove.isPending} onClick={() => remove.mutate(undefined, { onSuccess: done })}>Remove this idea</button>
          ) : null}
        </div>
      </form>
    </dialog>
  );
}
