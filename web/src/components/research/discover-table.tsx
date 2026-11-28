'use client';

import Link from 'next/link';
import { useId, useState } from 'react';
import { MutationError, SourceQuote, StatusBadge } from '@/components/app';
import { useSources } from '@/components/brand/data';
import { api, unwrap, type Schemas } from '@/lib/api/client';
import { httpUrl } from '@/lib/url';
import { useAct, useCandidates, useTargets, type Candidate } from './lib';

type Cell = Schemas['DiscoveryCell'];
type Source = Schemas['Source'];
type OwnRow = NonNullable<Schemas['DiscoveryRun']['ownRow']>;
type Key = keyof Schemas['DiscoveryCells'];

const COLUMNS: [Key, string][] = [['kind', 'Kind'], ['sells', 'Sells'], ['sellsTo', 'For'], ['priceLevel', 'Price'], ['where', 'Where'], ['pitch', 'Pitch'], ['overlap', 'Overlap']];
const OWN: Partial<Record<Key, keyof OwnRow>> = { sells: 'sells', sellsTo: 'sellsTo', priceLevel: 'priceLevel', where: 'where', pitch: 'pitch' };
const MAX_WATCHED = 10;
const KINDS = ['direct', 'indirect', 'aspirational'];
const DASH = <span className="text-muted" aria-label="none">—</span>;
const SOCIAL: [RegExp, string][] = [[/(^|\.)(facebook\.com|fb\.com)$/, 'FB'], [/(^|\.)instagram\.com$/, 'IG'], [/(^|\.)tiktok\.com$/, 'TikTok'], [/(^|\.)(youtube\.com|youtu\.be)$/, 'YouTube'], [/(^|\.)(x\.com|twitter\.com)$/, 'X'], [/(^|\.)linkedin\.com$/, 'LinkedIn']];
const chipClass = 'inline-flex h-6 items-center rounded-full border border-line px-2 text-xs font-medium text-action underline-offset-2 hover:underline';

const channelLabel = (href: string) => {
  const host = new URL(href).hostname;
  return SOCIAL.find(([re]) => re.test(host))?.[1] ?? host.replace(/^www\./, '');
};
const sourceLabel = (s: Source) => {
  const u = new URL(s.uri);
  return `${u.hostname.replace(/^www\./, '')}${u.pathname === '/' ? '' : u.pathname}`;
};

/** A value that opens (native popover, so keyboard and touch work) the reason or the quote behind it. */
function CellButton({ cell, c, sources, brandId }: { cell?: Cell; c: Candidate; sources: Source[]; brandId: string }) {
  const id = useId();
  if (!cell) return DASH;
  const find = (sid: string) => sources.find((s) => s.id === sid && httpUrl(s.uri));
  const inferred = cell.basis === 'inferred';
  const ids = inferred ? cell.evidence : [];
  const facts = ids.filter((e) => !c.sourceIds.includes(e));
  return (
    <>
      <button type="button" popoverTarget={id} className="text-left break-words underline decoration-line-strong decoration-dotted underline-offset-2">
        {cell.value}
        {inferred ? <span aria-hidden> ~</span> : null}
        <span className="sr-only"> ({inferred ? 'inferred, show why' : 'quoted, show the source'})</span>
      </button>
      <div id={id} popover="auto" className="panel m-auto w-[min(26rem,calc(100vw-2rem))] p-4 text-sm text-ink">
        <div className="grid gap-2">
          {cell.basis === 'quoted' ? (
            find(cell.sourceId) ? <SourceQuote quote={cell.quote} source={find(cell.sourceId)!} /> : <p>“{cell.quote}”</p>
          ) : (
            <>
              <p className="break-words">{cell.reason}</p>
              <p className="text-muted">{cell.confidence} confidence</p>
              <ul className="grid gap-1">
                {ids.filter((e) => c.sourceIds.includes(e)).map((e) => {
                  const s = find(e);
                  return (
                    <li key={e}>
                      {s ? <a href={httpUrl(s.uri)!} target="_blank" rel="noopener noreferrer" className="break-all text-action underline">{sourceLabel(s)}<span className="sr-only"> (opens in a new tab)</span></a> : <span className="text-muted">A saved source</span>}
                    </li>
                  );
                })}
                {facts.length ? <li>Approved facts: <Link href={`/app/b/${brandId}/brand/review`} className="text-action underline">Brand review</Link></li> : null}
              </ul>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function Channels({ c }: { c: Candidate }) {
  const links = [httpUrl(c.site) ? ['Web', httpUrl(c.site)!] : null, ...c.channels.map((u) => (httpUrl(u) ? [channelLabel(httpUrl(u)!), httpUrl(u)!] : null))].filter((x): x is string[] => !!x);
  const map = c.place ? `Map${c.place.rating != null ? ` ${c.place.rating.toFixed(1)}★` : ''}` : null;
  const mapHref = c.place?.cid ? `https://maps.google.com/?cid=${encodeURIComponent(c.place.cid)}` : null;
  if (!links.length && !map) return DASH;
  return (
    <span className="flex flex-wrap gap-1">
      {links.map(([label, href]) => (
        <a key={href} href={href} target="_blank" rel="noopener noreferrer" className={chipClass}>{label}<span className="sr-only"> (opens in a new tab)</span></a>
      ))}
      {map ? mapHref ? <a href={mapHref} target="_blank" rel="noopener noreferrer" className={chipClass}>{map}<span className="sr-only"> (opens in a new tab)</span></a> : <span className={chipClass.replace('text-action', 'text-muted')}>{map}</span> : null}
    </span>
  );
}

const TD = 'min-w-36 max-w-56 px-3 py-2.5 align-top break-words';
const STICKY = 'sticky left-0 z-[1] min-w-44 max-w-56 bg-panel px-3 py-2.5 align-top break-words shadow-[1px_0_0_var(--color-line)]';

/** The own row pinned first, then the ranked candidates, with watch, hide and restore. */
export function DiscoverTable({ brandId, own }: { brandId: string; own: OwnRow | null }) {
  const shown = useCandidates(brandId);
  const hidden = useCandidates(brandId, 'dismissed');
  const targets = useTargets(brandId);
  const sources = useSources(brandId);
  const [picked, setPicked] = useState<string[]>([]);
  const [kind, setKind] = useState('');
  const [unreadable, setUnreadable] = useState<string[]>([]);
  const after = () => setPicked([]);
  const watch = useAct(brandId, (ids: string[]) => unwrap(api.POST('/api/brands/{brandId}/research/candidates/watch', { params: { path: { brandId } }, body: { ids } })));
  const dismiss = useAct(brandId, (ids: string[]) => Promise.all(ids.map((id) => unwrap(api.POST('/api/brands/{brandId}/research/candidates/{id}/dismiss', { params: { path: { brandId, id } } })))));
  const restore = useAct(brandId, (id: string) => unwrap(api.POST('/api/brands/{brandId}/research/candidates/{id}/restore', { params: { path: { brandId, id } } })));

  const list = (shown.data ?? []).filter((c) => !kind || (c.cells.kind?.value ?? '').trim().toLowerCase().startsWith(kind));
  const free = Math.max(0, MAX_WATCHED - new Set((targets.data ?? []).map((t) => t.competitorId)).size);
  const withSite = (shown.data ?? []).filter((c) => picked.includes(c.id) && httpUrl(c.site)).length;
  const over = withSite > free;
  const src = sources.data ?? [];
  const toggle = (id: string, on: boolean) => setPicked((p) => (on ? [...p, id] : p.filter((x) => x !== id)));

  if (!shown.data?.length && !own && !hidden.data?.length) return null;
  return (
    <section aria-labelledby="found-h" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="found-h" className="text-xl font-semibold">Businesses found</h2>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted">Kind</span>
          <select className="input h-9 py-0" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">All</option>
            {KINDS.map((k) => <option key={k} value={k}>{k[0]!.toUpperCase() + k.slice(1)}</option>)}
          </select>
        </label>
      </div>
      <div className="relative min-w-0 overflow-x-auto rounded-lg border border-line" tabIndex={0} role="region" aria-label="Competitors table, scrolls sideways">
        <table aria-label="Competitors found" className="w-max min-w-full border-collapse text-left text-sm">
          <thead className="bg-panel">
            <tr className="border-b border-line">
              <th scope="col" className="sticky left-0 z-[1] bg-panel px-3 py-2.5 text-xs font-semibold tracking-wide text-muted uppercase">Business</th>
              {COLUMNS.slice(0, 5).map(([, h]) => <th key={h} scope="col" className="px-3 py-2.5 text-xs font-semibold tracking-wide text-muted uppercase">{h}</th>)}
              <th scope="col" className="px-3 py-2.5 text-xs font-semibold tracking-wide text-muted uppercase">Channels</th>
              {COLUMNS.slice(5).map(([, h]) => <th key={h} scope="col" className="px-3 py-2.5 text-xs font-semibold tracking-wide text-muted uppercase">{h}</th>)}
              <th scope="col" className="px-3 py-2.5 text-xs font-semibold tracking-wide text-muted uppercase">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {own ? (
              <tr className="bg-[color-mix(in_oklab,var(--theme-brand)_6%,transparent)]">
                <th scope="row" className={`${STICKY} font-semibold`}>Your brand</th>
                {COLUMNS.slice(0, 5).map(([k]) => <td key={k} className={TD}>{OWN[k] && own[OWN[k]!] ? own[OWN[k]!]!.value : DASH}</td>)}
                <td className={TD}>{DASH}</td>
                <td className={TD}>{own.pitch ? own.pitch.value : DASH}</td>
                <td className={TD}>{DASH}</td>
                <td className={TD} />
              </tr>
            ) : null}
            {list.map((c) => {
              const cell = (k: Key) => <CellButton cell={c.cells[k]} c={c} sources={src} brandId={brandId} />;
              return (
                <tr key={c.id}>
                  <th scope="row" className={`${STICKY} font-semibold`}>
                    <span className="flex items-start gap-2">
                      {c.status === 'new' ? <input type="checkbox" className="mt-1 size-4 shrink-0" aria-label={`Select ${c.name}`} checked={picked.includes(c.id)} onChange={(e) => toggle(c.id, e.target.checked)} /> : null}
                      <span className="min-w-0 break-words">{c.name}</span>
                    </span>
                  </th>
                  {COLUMNS.slice(0, 5).map(([k]) => <td key={k} className={TD}>{cell(k)}</td>)}
                  <td className={TD}><Channels c={c} /></td>
                  {COLUMNS.slice(5).map(([k]) => <td key={k} className={TD}>{cell(k)}</td>)}
                  <td className={TD}>
                    <span className="grid gap-1">
                      {c.status === 'watched' ? <StatusBadge status="watching" /> : null}
                      {!httpUrl(c.site) && c.status === 'new' ? <span className="text-muted">No website to watch</span> : null}
                      {unreadable.includes(c.id) ? (
                        <span className="text-danger">
                          Couldn’t read the site; add pages on{' '}
                          {c.competitorId ? <Link href={`/app/b/${brandId}/research/competitors/${c.competitorId}`} className="underline">the competitor’s page</Link> : 'the competitor’s page'}
                        </span>
                      ) : null}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {shown.data?.length && !list.length ? <p className="text-sm text-muted">No business of that kind. Choose All to see the rest.</p> : null}
      <MutationError error={watch.error ?? dismiss.error ?? restore.error} />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!picked.length || over || watch.isPending}
          onClick={() => watch.mutate(picked, { onSuccess: (r) => { setUnreadable(r.unreadable); after(); } })}
        >
          {watch.isPending ? 'Watching…' : 'Watch selected'}
        </button>
        <button type="button" className="btn btn-secondary" disabled={!picked.length || dismiss.isPending} onClick={() => dismiss.mutate(picked, { onSuccess: after })}>Not a competitor</button>
        <span className={`text-sm ${over ? 'text-danger' : 'text-muted'}`}>{free} slot{free === 1 ? '' : 's'} free{over ? `. Untick ${withSite - free}.` : ''}</span>
      </div>
      {hidden.data?.length ? (
        <details className="panel px-4 py-3">
          <summary className="cursor-pointer font-medium">Hidden ({hidden.data.length})</summary>
          <ul className="mt-2 divide-y divide-line">
            {hidden.data.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 break-words">{c.name}</span>
                <button type="button" className="btn btn-quiet" disabled={restore.isPending} onClick={() => restore.mutate(c.id)}>Restore<span className="sr-only"> {c.name}</span></button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
