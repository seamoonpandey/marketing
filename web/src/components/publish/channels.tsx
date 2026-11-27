'use client';

import { useState } from 'react';
import { Async, LiveStatus, MutationError, PageHeader, StateBlock, StatusBadge, useBrandId } from '@/components/app';
import { api, unwrap, type Schemas } from '@/lib/api/client';
import { PLATFORMS, useAct, useCapabilities, useChannels, type Platform } from './lib';
import { label } from '@/lib/labels';
import { formatDateOnly } from '@/lib/time';

type Channel = Schemas['PublishChannel'];
const CHANNEL_STATUS: Record<Channel['status'], { badge: string; label: string; next: string }> = {
  connected: { badge: 'active', label: 'Connected', next: 'Posts to it are scheduled as normal.' },
  needs_reconnect: { badge: 'unverified', label: 'Needs reconnecting', next: 'Its posts are blocked. Reconnect it to let them go out.' },
  disabled: { badge: 'archived', label: 'Disabled', next: 'Posts to it are blocked. Enable it to use it again.' },
};

export function Channels() {
  const brandId = useBrandId()!;
  const channels = useChannels(brandId);
  const caps = useCapabilities(brandId);
  return (
    <>
      <PageHeader title="Channels" description="The accounts you post to. Every channel is posted by hand for now: at the scheduled time you get the finished post and confirm it with its link." />
      <div className="grid gap-10">
        <section aria-labelledby="ch-h" className="grid gap-3">
          <h2 id="ch-h" className="text-xl font-semibold">Your channels</h2>
          <Async q={channels} what="channels">
            {(list) => list.length ? (
              <ul className="grid gap-3">{list.map((c) => <Row key={c.id} brandId={brandId} c={c} />)}</ul>
            ) : (
              <StateBlock state="empty" title="No channels yet">Add the first account you post to, such as your Facebook page.</StateBlock>
            )}
          </Async>
          <AddForm brandId={brandId} />
        </section>
        <section aria-labelledby="cap-h" className="grid gap-3">
          <h2 id="cap-h" className="text-xl font-semibold">What each platform takes</h2>
          <Async q={caps} what="platform limits">
            {(list) => (
              <div className="panel overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">Limits per platform</caption>
                  <thead><tr className="border-b border-line text-muted">{['Platform', 'Text limit', 'Image shapes', 'Most media', 'Checked'].map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
                  <tbody>
                    {list.map((c) => (
                      <tr key={c.platform} className="border-b border-line last:border-0">
                        <th scope="row" className="px-3 py-2 font-medium">{label(c.platform)}</th>
                        <td className="num px-3 py-2">{c.textLimit === null ? 'No limit' : `${c.textLimit} characters`}</td>
                        <td className="px-3 py-2">{c.ratios.join(', ')}</td>
                        <td className="num px-3 py-2">{c.maxMedia}</td>
                        <td className="px-3 py-2">{c.verified ? c.lastVerified ? `Verified ${formatDateOnly(c.lastVerified)}` : 'Verified' : 'Not yet verified'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Async>
        </section>
      </div>
    </>
  );
}

function Row({ brandId, c }: { brandId: string; c: Channel }) {
  const set = useAct(brandId, (status: 'connected' | 'disabled') => unwrap(api.PATCH('/api/brands/{brandId}/publish/channels/{id}', { params: { path: { brandId, id: c.id } }, body: { status } })));
  const s = CHANNEL_STATUS[c.status];
  return (
    <li className="panel flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
      <div className="grid min-w-0 gap-0.5">
        <p className="font-semibold">{label(c.platform)} · {c.accountName}</p>
        <p className="text-sm text-muted">{c.mode === 'manual' ? 'Posted by hand' : 'Posted automatically'}. {s.next}</p>
        {c.accountUrl ? <a href={c.accountUrl} target="_blank" rel="noreferrer" className="text-sm break-all text-brand underline">{c.accountUrl}</a> : null}
      </div>
      <div className="ml-auto flex items-center gap-3">
        <StatusBadge status={s.badge} label={s.label} />
        {c.status === 'connected' ? (
          <button type="button" className="btn btn-secondary" disabled={set.isPending} onClick={() => set.mutate('disabled')}>Disable</button>
        ) : (
          <button type="button" className="btn btn-secondary" disabled={set.isPending} onClick={() => set.mutate('connected')}>{c.status === 'disabled' ? 'Enable' : 'Reconnect'}</button>
        )}
      </div>
      <MutationError error={set.error} />
      <LiveStatus message={set.isSuccess ? 'Channel updated.' : ''} />
    </li>
  );
}

function AddForm({ brandId }: { brandId: string }) {
  const [platform, setPlatform] = useState<Platform>('instagram');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const add = useAct(brandId, () =>
    unwrap(api.POST('/api/brands/{brandId}/publish/channels', { params: { path: { brandId } }, body: { platform, accountName: name, ...(url.trim() ? { accountUrl: url.trim() } : {}) } })).then(() => { setName(''); setUrl(''); }),
  );
  return (
    <form className="panel grid gap-3 p-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); add.mutate(); }} aria-labelledby="add-h">
      <h3 id="add-h" className="font-semibold sm:col-span-2">Add a channel</h3>
      <div className="field">
        <label htmlFor="ch-platform" className="label">Platform</label>
        <select id="ch-platform" className="input" value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}>
          {PLATFORMS.map((p) => <option key={p} value={p}>{label(p)}</option>)}
        </select>
      </div>
      <div className="field"><label htmlFor="ch-name" className="label">Account name</label><input id="ch-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} placeholder="@himalpashmina" /></div>
      <div className="field sm:col-span-2"><label htmlFor="ch-url" className="label">Account link (optional)</label><input id="ch-url" type="url" className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" /></div>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button type="submit" className="btn btn-primary" disabled={add.isPending || !name.trim()}>{add.isPending ? 'Adding…' : 'Add channel'}</button>
        <MutationError error={add.error} />
        <LiveStatus message={add.isSuccess ? 'Channel added.' : ''} />
      </div>
    </form>
  );
}
