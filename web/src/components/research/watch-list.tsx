'use client';

import { useState } from 'react';
import { StatusBadge } from '@/components/app';
import { api, unwrap } from '@/lib/api/client';
import { Async, MutationError, useAct, useTargets } from './lib';

const LIMIT = 5;

/** The pages watched for one competitor: suggest, add, pause or resume, remove. */
export function WatchList({ brandId, competitorId, site }: { brandId: string; competitorId: string; site: string | null }) {
  const targets = useTargets(brandId, competitorId);
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const path = { brandId };
  const add = useAct(brandId, (v: { url: string; label?: string }) =>
    unwrap(api.POST('/api/brands/{brandId}/research/targets', { params: { path }, body: { competitorId, ...v } })),
  );
  const suggest = useAct(brandId, () => unwrap(api.POST('/api/brands/{brandId}/research/targets/suggest', { params: { path }, body: { competitorId } })));
  const toggle = useAct(brandId, (v: { id: string; status: 'active' | 'paused' }) =>
    unwrap(api.PATCH('/api/brands/{brandId}/research/targets/{id}', { params: { path: { brandId, id: v.id } }, body: { status: v.status } })),
  );
  const remove = useAct(brandId, (id: string) => unwrap(api.DELETE('/api/brands/{brandId}/research/targets/{id}', { params: { path: { brandId, id } } })));

  return (
    <section aria-labelledby="watch-h" className="grid gap-3">
      <h2 id="watch-h" className="text-xl font-semibold">Watched pages</h2>
      <Async q={targets} what="watched pages">
        {(list) => {
          const full = list.length >= LIMIT;
          const proposed = (suggest.data?.urls ?? []).filter((u) => !list.some((t) => t.url === u));
          return (
            <>
              {list.length === 0 ? (
                <p className="panel p-4 text-sm text-muted">No pages yet. Pricing, offers and the home page are the ones worth watching{site ? '; let Prachaar suggest them from the site' : ''}.</p>
              ) : (
                <ul className="panel divide-y divide-line" aria-label="Watched pages">
                  {list.map((t) => (
                    <li key={t.id} className="grid gap-2 px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                        <div className="grid min-w-0 gap-0.5">
                          {t.label ? <span className="font-semibold break-words">{t.label}</span> : null}
                          <a href={t.url} target="_blank" rel="noopener noreferrer" className="text-sm break-all text-action underline decoration-line-strong hover:decoration-current">
                            {t.url}<span className="sr-only"> (opens in a new tab)</span>
                          </a>
                        </div>
                        <div className="flex items-center gap-2">
                          <StatusBadge status={t.status} />
                          {t.status === 'active' || t.status === 'paused' ? (
                            <button type="button" className="btn btn-secondary" disabled={toggle.isPending} onClick={() => toggle.mutate({ id: t.id, status: t.status === 'active' ? 'paused' : 'active' })}>
                              {t.status === 'active' ? 'Pause' : 'Resume'}<span className="sr-only"> {t.label ?? t.url}</span>
                            </button>
                          ) : null}
                          <button type="button" className="btn btn-quiet" disabled={remove.isPending} onClick={() => remove.mutate(t.id)}>
                            Remove<span className="sr-only"> {t.label ?? t.url}</span>
                          </button>
                        </div>
                      </div>
                      {t.lastError ? <p className="text-sm text-danger">{t.failCount > 0 ? `Failed ${t.failCount} run${t.failCount === 1 ? '' : 's'} in a row: ` : ''}{t.lastError}</p> : null}
                    </li>
                  ))}
                </ul>
              )}
              {full ? <p className="text-sm text-muted">Five pages is the most one competitor can have. Remove one to add another.</p> : null}

              {proposed.length ? (
                <div className="panel grid gap-2 p-4" role="group" aria-label="Suggested pages">
                  <p className="text-sm font-semibold">Suggested from the site</p>
                  <ul className="grid gap-2">
                    {proposed.map((u) => (
                      <li key={u} className="flex flex-wrap items-center justify-between gap-3">
                        <span className="min-w-0 text-sm break-all">{u}</span>
                        <button type="button" className="btn btn-secondary" disabled={full || add.isPending} onClick={() => add.mutate({ url: u })}>
                          Add<span className="sr-only"> {u}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : suggest.isSuccess ? (
                <p role="status" className="text-sm text-muted">No new pages to suggest.</p>
              ) : null}

              <form
                className="panel grid gap-3 p-4 sm:grid-cols-[1fr_12rem_auto] sm:items-end"
                onSubmit={(e) => {
                  e.preventDefault();
                  add.mutate({ url: url.trim(), ...(label.trim() ? { label: label.trim() } : {}) }, { onSuccess: () => { setUrl(''); setLabel(''); } });
                }}
              >
                <div className="field">
                  <label htmlFor="wt-url" className="label">Page address</label>
                  <input id="wt-url" className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" required inputMode="url" disabled={full} />
                </div>
                <div className="field">
                  <label htmlFor="wt-label" className="label">Name (optional)</label>
                  <input id="wt-label" className="input" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={200} disabled={full} />
                </div>
                <div className="flex gap-2">
                  <button type="submit" className="btn btn-primary" disabled={full || add.isPending}>{add.isPending ? 'Adding…' : 'Add page'}</button>
                  <button type="button" className="btn btn-secondary" disabled={full || suggest.isPending} onClick={() => suggest.mutate()}>
                    {suggest.isPending ? 'Looking…' : 'Suggest pages'}
                  </button>
                </div>
              </form>
              <MutationError error={add.error ?? suggest.error ?? toggle.error ?? remove.error} />
            </>
          );
        }}
      </Async>
    </section>
  );
}
