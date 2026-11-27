'use client';

import { useEffect, useState } from 'react';
import { Async, MutationError, PageHeader, useBrandId } from '@/components/app';
import { api, unwrap } from '@/lib/api/client';
import { CHANNELS, PILLARS, useAct, useSettings, type Settings } from './lib';
import { WEEKDAYS } from '@/lib/time';
import { label } from '@/lib/labels';

export function SettingsView() {
  const brandId = useBrandId()!;
  const q = useSettings(brandId);
  return (
    <>
      <PageHeader title="Plan settings" description="Where the brand posts, how often, and what it talks about. Drafts follow these." />
      <Async q={q} what="settings">{(s) => <Form brandId={brandId} s={s} />}</Async>
    </>
  );
}

function Form({ brandId, s }: { brandId: string; s: Settings }) {
  const [channels, setChannels] = useState<Record<string, number>>(Object.fromEntries(s.channels.map((c) => [c.channel, c.postsPerWeek])));
  const [pillars, setPillars] = useState<Record<string, number>>(Object.fromEntries(s.pillars.map((c) => [c.pillar, c.weight])));
  const [weekStarts, setWeekStarts] = useState(s.weekStarts);
  const [saved, setSaved] = useState(false);
  useEffect(() => setSaved(false), [channels, pillars, weekStarts]);
  const save = useAct(brandId, () =>
    unwrap(api.PUT('/api/brands/{brandId}/plan/settings', {
      params: { path: { brandId } },
      body: {
        channels: CHANNELS.filter((c) => c in channels).map((channel) => ({ channel, postsPerWeek: channels[channel]! })),
        pillars: PILLARS.filter((p) => p in pillars).map((pillar) => ({ pillar, weight: pillars[pillar]! })),
        weekStarts,
      },
    })),
  );
  const toggle = <T,>(set: (f: (m: Record<string, T>) => Record<string, T>) => void, key: string, initial: T) =>
    set((m) => { const { [key]: gone, ...rest } = m; return gone === undefined ? { ...m, [key]: initial } : rest; });
  const invalid = Object.values(channels).some((n) => !Number.isInteger(n) || n < 1 || n > 14) || Object.values(pillars).some((n) => !(n >= 0));

  return (
    <form className="grid max-w-3xl gap-8" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined, { onSuccess: () => setSaved(true) }); }}>
      <fieldset className="grid gap-3">
        <legend className="text-xl font-semibold">Channels</legend>
        <p className="text-sm text-muted">Tick the channels the brand posts on and set posts per week for each.</p>
        <ul className="panel divide-y divide-line">
          {CHANNELS.map((c) => (
            <li key={c} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
              <label className="flex items-center gap-2.5 font-medium"><input type="checkbox" className="size-4" checked={c in channels} onChange={() => toggle(setChannels, c, 3)} />{label(c)}</label>
              {c in channels ? (
                <label className="flex items-center gap-2 text-sm text-muted">
                  <span><span className="sr-only">{label(c)} </span>Posts per week</span>
                  <input type="number" min={1} max={14} step={1} className="input !w-20" value={channels[c]} onChange={(e) => setChannels({ ...channels, [c]: e.target.valueAsNumber })} />
                </label>
              ) : null}
            </li>
          ))}
        </ul>
      </fieldset>

      <fieldset className="grid gap-3">
        <legend className="text-xl font-semibold">Content pillars</legend>
        <p className="text-sm text-muted">The themes the brand returns to. A higher weight means more of the week. No one pillar should pass 40% of a week.</p>
        <ul className="panel divide-y divide-line">
          {PILLARS.map((p) => (
            <li key={p} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
              <label className="flex items-center gap-2.5 font-medium"><input type="checkbox" className="size-4" checked={p in pillars} onChange={() => toggle(setPillars, p, 1)} />{label(p)}</label>
              {p in pillars ? (
                <label className="flex items-center gap-2 text-sm text-muted">
                  <span><span className="sr-only">{label(p)} </span>Weight</span>
                  <input type="number" min={0} step="any" className="input !w-20" value={pillars[p]} onChange={(e) => setPillars({ ...pillars, [p]: e.target.valueAsNumber })} />
                </label>
              ) : null}
            </li>
          ))}
        </ul>
      </fieldset>

      <div className="field max-w-xs">
        <label htmlFor="ws" className="text-xl font-semibold">First day of the week</label>
        <select id="ws" className="input" value={weekStarts} onChange={(e) => setWeekStarts(Number(e.target.value))}>{WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select>
        <p className="hint">Nepal’s week starts on Sunday.</p>
      </div>

      <MutationError error={save.error} />
      <div className="flex items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={save.isPending || invalid}>{save.isPending ? 'Saving…' : 'Save settings'}</button>
        {invalid ? <span className="text-sm text-danger">Posts per week must be 1 to 14, and weights cannot be negative.</span> : null}
        {saved ? <span role="status" className="text-sm text-muted">Saved</span> : null}
      </div>
    </form>
  );
}
