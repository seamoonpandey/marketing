'use client';

import { useEffect, useState } from 'react';
import { Async, MutationError, StateBlock } from '@/components/app';
import { api, unwrap } from '@/lib/api/client';
import { formatDate, useAct, useSchedule } from './lib';
import { WEEKDAYS } from '@/lib/time';

const DAY = 86_400_000;

export function SchedulePanel({ brandId }: { brandId: string }) {
  const schedule = useSchedule(brandId);
  return (
    <section aria-labelledby="schedule-h" className="grid gap-3">
      <h2 id="schedule-h" className="text-xl font-semibold">Schedule</h2>
      <Async q={schedule} what="schedule">{(s) => <Form brandId={brandId} s={s} />}</Async>
    </section>
  );
}

function Form({ brandId, s }: { brandId: string; s: { enabled: boolean; weekday: number; hour: number; lastRunAt: string | null } }) {
  const [v, setV] = useState({ enabled: s.enabled, weekday: s.weekday, hour: s.hour });
  useEffect(() => setV({ enabled: s.enabled, weekday: s.weekday, hour: s.hour }), [s.enabled, s.weekday, s.hour]);
  const save = useAct(brandId, () => unwrap(api.PUT('/api/brands/{brandId}/research/schedule', { params: { path: { brandId } }, body: v })));
  const dirty = v.enabled !== s.enabled || v.weekday !== s.weekday || v.hour !== s.hour;
  const stale = s.enabled && s.lastRunAt && Date.now() - new Date(s.lastRunAt).getTime() > 8 * DAY;
  return (
    <form className="panel grid gap-4 p-5" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <label className="flex items-center gap-2.5 font-medium">
        <input type="checkbox" className="size-4" checked={v.enabled} onChange={(e) => setV({ ...v, enabled: e.target.checked })} />
        Run every week
      </label>
      <div className="grid grid-cols-2 gap-3">
        <div className="field">
          <label htmlFor="sch-day" className="label">Day</label>
          <select id="sch-day" className="input" value={v.weekday} disabled={!v.enabled} onChange={(e) => setV({ ...v, weekday: Number(e.target.value) })}>
            {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="sch-hour" className="label">Hour</label>
          <select id="sch-hour" className="input" value={v.hour} disabled={!v.enabled} onChange={(e) => setV({ ...v, hour: Number(e.target.value) })}>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
          </select>
        </div>
      </div>
      <p className="text-sm text-muted">In the brand’s time zone. Last run: {formatDate(s.lastRunAt)}.</p>
      {stale ? <StateBlock state="stale" size="inline" title="The last run was over a week ago">A weekly run may be waiting for approval, or it failed. Check the run above.</StateBlock> : null}
      <div className="flex items-center gap-3">
        <button type="submit" className="btn btn-secondary" disabled={!dirty || save.isPending}>{save.isPending ? 'Saving…' : 'Save schedule'}</button>
        {save.isSuccess && !dirty ? <span role="status" className="text-sm text-muted">Saved</span> : null}
      </div>
      <MutationError error={save.error} />
    </form>
  );
}
