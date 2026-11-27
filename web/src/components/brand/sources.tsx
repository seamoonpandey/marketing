'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, FileUp, Globe, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { Async, CostConfirm, MoneyText, MutationError, PageHeader, RunProgress, StateBlock, StatusBadge, useBrand, useBrandId } from '@/components/app';
import { api, errorMessage, type Schemas, unwrap } from '@/lib/api/client';
import { importKey, refreshAll, useAssets, useImports, useSources } from './data';

type Source = Schemas['Source'];
type Asset = Schemas['Asset'];
type Rights = Schemas['AssetRights'];

type Pending = { key: number; name: string; pct: number; error?: string };

// fetch has no upload progress, so the PUT to storage uses XHR.
function put(url: string, file: File, type: string, onPct: (n: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('PUT', url);
    x.setRequestHeader('Content-Type', type);
    x.upload.onprogress = (e) => e.lengthComputable && onPct(Math.round((e.loaded / e.total) * 100));
    x.onload = () => (x.status < 300 ? resolve() : reject(new Error(`The file could not be stored (${x.status}).`)));
    x.onerror = () => reject(new Error('The upload was interrupted. Try the file again.'));
    x.send(file);
  });
}

export function SourcesScreen() {
  const brandId = useBrandId()!;
  const sources = useSources(brandId);
  const assets = useAssets(brandId);
  const imports = useImports(brandId);
  const brand = useBrand(brandId);
  const client = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [site, setSite] = useState('');
  const [edited, setEdited] = useState(false);
  const [include, setInclude] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Pending[]>([]);
  const [runId, setRunId] = useState<string | null>(null);

  // Filled after mount, so the first client render matches the server's (no data yet).
  useEffect(() => { if (!edited && brand.data?.website) setSite(brand.data.website); }, [edited, brand.data?.website]);
  const url = site;
  const uploads = (sources.data ?? []).filter((s) => s.kind === 'upload');
  const latest = [...(imports.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const activeRunId = runId ?? latest?.id ?? null;

  async function upload(file: File) {
    const key = Date.now() + Math.random();
    const patch = (p: Partial<Pending>) => setPending((l) => l.map((x) => (x.key === key ? { ...x, ...p } : x)));
    setPending((l) => [...l, { key, name: file.name, pct: 0 }]);
    const mime = file.type || 'application/octet-stream';
    try {
      const made = await unwrap(api.POST('/api/brands/{brandId}/sources/uploads', { params: { path: { brandId } }, body: { filename: file.name, mime, bytes: file.size } }));
      await put(made.uploadUrl, file, mime, (pct) => patch({ pct }));
      const done = await unwrap(api.POST('/api/brands/{brandId}/sources/{id}/complete', { params: { path: { brandId, id: made.source.id } } }));
      setInclude((s) => new Set(s).add(done.id));
      await refreshAll(client, brandId);
      setPending((l) => l.filter((x) => x.key !== key));
    } catch (e) {
      patch({ error: errorMessage(e) });
    }
  }

  const start = useMutation({
    mutationFn: () => {
      const u = url.trim();
      return unwrap(
        api.POST('/api/brands/{brandId}/knowledge/imports', {
          params: { path: { brandId } },
          body: { websiteUrl: u ? (/^https?:\/\//i.test(u) ? u : `https://${u}`) : null, sourceIds: [...include] },
        }),
      );
    },
    onSuccess: async (run) => {
      setRunId(run.id);
      await refreshAll(client, brandId);
    },
  });

  return (
    <>
      <PageHeader title="Sources" description="Give Prachaar the website and the files that describe the brand. It reads them, shows what it would cost, and starts only when you confirm." />
      <div className="grid gap-6">
        <section aria-labelledby="src-site" className="panel grid gap-4 p-5">
          <h2 id="src-site" className="flex items-center gap-2 text-lg font-semibold"><Globe className="size-[1.125rem]" strokeWidth={1.75} aria-hidden /> Website</h2>
          <div className="field max-w-xl">
            <label htmlFor="site" className="label">Website address</label>
            <input id="site" className="input" inputMode="url" value={url} placeholder="himalpashmina.com.np" onChange={(e) => { setEdited(true); setSite(e.target.value); }} />
            <p className="hint">Prachaar picks the pages that matter. Reading pages costs nothing.</p>
          </div>
        </section>

        <section aria-labelledby="src-files" className="panel grid gap-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="grid gap-1">
              <h2 id="src-files" className="flex items-center gap-2 text-lg font-semibold"><FileUp className="size-[1.125rem]" strokeWidth={1.75} aria-hidden /> Files</h2>
              <p className="max-w-[60ch] text-sm text-muted">Logos, the brand guide, the price list, any other document. Say what each is, and for images and fonts, who owns the rights.</p>
            </div>
            <input
              ref={input} type="file" multiple className="sr-only" tabIndex={-1} aria-label="Choose files to upload"
              onChange={(e) => { [...(e.target.files ?? [])].forEach((f) => void upload(f)); e.target.value = ''; }}
            />
            <button type="button" className="btn btn-secondary" onClick={() => input.current?.click()}>Add files</button>
          </div>

          {pending.length ? (
            <ul aria-label="Uploading" className="grid gap-2">
              {pending.map((p) => (
                <li key={p.key} className="grid gap-1.5 rounded-md border border-line px-3 py-2.5">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0 font-medium break-all">{p.name}</span>
                    {p.error ? (
                      <button type="button" className="btn btn-quiet h-7" aria-label={`Dismiss ${p.name}`} onClick={() => setPending((l) => l.filter((x) => x.key !== p.key))}>
                        <X className="size-4" aria-hidden />
                      </button>
                    ) : (
                      <span className="num text-muted">{p.pct}%</span>
                    )}
                  </div>
                  {p.error ? (
                    <p role="alert" className="text-sm text-danger">{p.error}</p>
                  ) : (
                    <div role="progressbar" aria-label={`Uploading ${p.name}`} aria-valuenow={p.pct} aria-valuemin={0} aria-valuemax={100} className="h-1 overflow-hidden rounded-full bg-line">
                      <div className="h-full rounded-full bg-brand motion-safe:transition-[width]" style={{ width: `${p.pct}%` }} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : null}

          <Async q={sources} what="files" rows={2}>
            {() =>
              uploads.length ? (
                <ul aria-label="Uploaded files" className="grid gap-3">
                  {uploads.map((s) => (
                    <FileRow
                      key={s.id} brandId={brandId} source={s} asset={assets.data?.find((a) => a.sourceId === s.id)} included={include.has(s.id)}
                      onInclude={(on) => setInclude((set) => { const n = new Set(set); if (on) n.add(s.id); else n.delete(s.id); return n; })}
                    />
                  ))}
                </ul>
              ) : pending.length ? null : (
                <StateBlock state="empty" size="inline" title="No files yet">Add a logo, the brand guide or a price list. You can also import from the website alone.</StateBlock>
              )
            }
          </Async>
        </section>

        <section aria-labelledby="src-run" className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="src-run" className="text-lg font-semibold">Import</h2>
            <button
              type="button" className="btn btn-primary" onClick={() => start.mutate()}
              disabled={start.isPending || (!url.trim() && !include.size) || latest?.state === 'running' || latest?.state === 'awaiting_approval'}
            >
              {start.isPending ? 'Starting…' : 'Start import'}
            </button>
          </div>
          {start.isError ? <StateBlock state="error" size="inline" title="The import could not start">{start.error.message}</StateBlock> : null}
          {imports.isError && !imports.data ? <StateBlock state="error" size="inline" title="Earlier imports could not be loaded">{imports.error.message}</StateBlock> : null}
          {activeRunId ? (
            <Run brandId={brandId} runId={activeRunId} />
          ) : !start.isError ? (
            <StateBlock state="empty" size="inline" title="No import yet">Add the website or files above, then start. Nothing is spent until you confirm the estimate.</StateBlock>
          ) : null}
        </section>
      </div>
    </>
  );
}

function Run({ brandId, runId }: { brandId: string; runId: string }) {
  const client = useQueryClient();
  const key = importKey(brandId, runId);
  const call = (verb: 'confirm' | 'cancel' | 'retry') => () =>
    unwrap(api.POST(`/api/brands/{brandId}/knowledge/imports/{runId}/${verb}`, { params: { path: { brandId, runId } } })).then((r) => {
      client.setQueryData(key, r);
      return refreshAll(client, brandId);
    });
  const fetchRun = () => unwrap(api.GET('/api/brands/{brandId}/knowledge/imports/{runId}', { params: { path: { brandId, runId } } }));
  const run = useQuery({ queryKey: key, queryFn: fetchRun });
  const confirm = useMutation({ mutationFn: call('confirm') });
  const cancel = useMutation({ mutationFn: call('cancel') });
  const state = run.data?.state;
  useEffect(() => {
    if (state === 'completed') void refreshAll(client, brandId);
  }, [state, client, brandId]);
  const r = run.data;
  const s = (n: number) => (n === 1 ? '' : 's');

  return (
    <div className="grid gap-4">
      <RunProgress queryKey={key} fetchRun={fetchRun} label="Import" onCancel={call('cancel')} onRetry={call('retry')} />
      {r && r.stage !== 'fetch' && r.counts.pages + r.counts.pagesFailed > 0 && state !== 'completed' ? (
        <p className="text-sm text-muted">
          Read {r.counts.pages} page{s(r.counts.pages)}
          {r.counts.pagesFailed ? `, ${r.counts.pagesFailed} could not be read` : ''}, with {r.counts.files} file{s(r.counts.files)}.
        </p>
      ) : null}
      {r && state === 'awaiting_approval' && r.estimate ? (
        <>
          {r.blocked ? <StateBlock state="rate_limited" size="inline" title="Over this month’s budget">{r.blocked}</StateBlock> : null}
          <CostConfirm estimate={r.estimate} remaining={r.remaining} pending={confirm.isPending} onConfirm={() => confirm.mutate()} onCancel={() => cancel.mutate()}>
            Reading {r.counts.pages} page{s(r.counts.pages)} and {r.counts.files} file{s(r.counts.files)} in {r.counts.batches} model call{s(r.counts.batches)}.
          </CostConfirm>
          <MutationError error={confirm.error} />
        </>
      ) : null}
      {r && state === 'completed' ? (
        <section aria-label="Import result" className="panel grid gap-4 p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h3 className="text-lg font-semibold">Import finished</h3>
            <p className="text-sm text-muted">Cost {r.actual ? <MoneyText value={r.actual} /> : '—'}</p>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            {(
              [['Quote-checked', r.counts.unverified], ['Inferred', r.counts.inferred], ['Conflicts', r.counts.conflicts], ['Colours', r.counts.colours]] as const
            ).map(([k, v]) => (
              <div key={k} className="grid gap-0.5">
                <dt className="text-sm text-muted">{k}</dt>
                <dd className="num text-xl font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
          {r.counts.unchanged || r.counts.dropped ? (
            <p className="text-sm text-muted">
              {r.counts.unchanged} already known{r.counts.dropped ? `, ${r.counts.dropped} answers dropped because they did not fit a brand field` : ''}.
            </p>
          ) : null}
          <div>
            <Link href={`/app/b/${brandId}/brand/review`} className="btn btn-primary">Review the facts <ArrowRight className="size-4" aria-hidden /></Link>
          </div>
        </section>
      ) : null}
    </div>
  );
}

const USE = [['document', 'Document to read'], ['logo', 'Logo'], ['font', 'Font'], ['photo', 'Photo'], ['other', 'Other asset']] as const;

function FileRow({ brandId, source, asset, included, onInclude }: { brandId: string; source: Source; asset?: Asset; included: boolean; onInclude: (on: boolean) => void }) {
  const id = useId();
  const client = useQueryClient();
  const name = String(source.meta.filename ?? 'Uploaded file');
  const [use, setUse] = useState<string>(asset?.kind ?? (source.mime.startsWith('image/') ? 'logo' : 'document'));
  const [variant, setVariant] = useState(asset?.variant ?? '');
  const [rights, setRights] = useState<Rights>(asset?.rights ?? {});
  const set = (p: Partial<Rights>) => setRights((r) => ({ ...r, ...p }));
  const save = useMutation({
    mutationFn: () => {
      const body = { kind: use as Asset['kind'], variant: variant.trim() || null, rights };
      return asset
        ? unwrap(api.PATCH('/api/brands/{brandId}/knowledge/assets/{id}', { params: { path: { brandId, id: asset.id } }, body }))
        : unwrap(api.POST('/api/brands/{brandId}/knowledge/assets', { params: { path: { brandId } }, body: { sourceId: source.id, ...body } }));
    },
    onSuccess: () => refreshAll(client, brandId),
  });
  const text = (k: 'owner' | 'licence' | 'territory' | 'term', label: string, max: number) => (
    <div className="field">
      <label htmlFor={`${id}-${k}`} className="label">{label}</label>
      <input id={`${id}-${k}`} className="input" value={rights[k] ?? ''} maxLength={max} onChange={(e) => set({ [k]: e.target.value })} />
    </div>
  );

  return (
    <li className="grid gap-3 rounded-md border border-line p-3.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex min-w-0 flex-1 items-center gap-2.5 font-medium">
          <input type="checkbox" className="size-4" checked={included} onChange={(e) => onInclude(e.target.checked)} />
          <span className="min-w-0 break-all">{name}<span className="sr-only"> (include in import)</span></span>
        </label>
        {asset ? <StatusBadge status={asset.licensed ? 'approved' : 'unverified'} label={asset.licensed ? 'Licence noted' : 'Licence missing'} /> : null}
        <span className="num text-sm text-muted">{source.mime}</span>
        <div className="field">
          <label htmlFor={`${id}-use`} className="sr-only">What is {name}?</label>
          <select id={`${id}-use`} className="input h-9 w-auto" value={use} onChange={(e) => setUse(e.target.value)}>
            {USE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>
      {use !== 'document' ? (
        <form className="grid gap-4 border-t border-line pt-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }} aria-label={`Rights for ${name}`}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="field">
              <label htmlFor={`${id}-var`} className="label">Variant</label>
              <input id={`${id}-var`} className="input" value={variant} placeholder="white on transparent" maxLength={200} onChange={(e) => setVariant(e.target.value)} />
            </div>
            {text('owner', 'Creator or owner', 200)}
            {text('licence', 'Licence', 500)}
            {text('territory', 'Territory', 200)}
            {text('term', 'Term', 200)}
            <div className="field">
              <label htmlFor={`${id}-exp`} className="label">Expires</label>
              <input id={`${id}-exp`} className="input" type="date" value={rights.expiresAt ?? ''} onChange={(e) => set({ expiresAt: e.target.value })} />
            </div>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" className="size-4" checked={!!rights.commercialUse} onChange={(e) => set({ commercialUse: e.target.checked })} /> Commercial use allowed</label>
            <label className="flex items-center gap-2"><input type="checkbox" className="size-4" checked={!!rights.paidUse} onChange={(e) => set({ paidUse: e.target.checked })} /> Paid ads allowed</label>
          </div>
          <MutationError error={save.error} />
          {save.isSuccess ? (
            <p role="status" className="text-sm font-medium text-success">
              Saved.{use === 'logo' ? ' The logo’s colours appear in the palette after the next import.' : ''}
            </p>
          ) : null}
          <div><button type="submit" className="btn btn-secondary" disabled={save.isPending}>{save.isPending ? 'Saving…' : `Save rights for ${name}`}</button></div>
        </form>
      ) : null}
    </li>
  );
}
