'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useId, useRef, useState } from 'react';
import { Async, LiveStatus, MutationError, PageHeader, StateBlock, StatusBadge, useBrand, useBrandId } from '@/components/app';
import { api, unwrap, type Schemas } from '@/lib/api/client';
import { type Fact, refreshAll, uploadFile, useBook, useFacts, usePalette, useSources } from './data';

type Colour = Schemas['PaletteColour'];
type Asset = Schemas['Asset'];
type Source = Schemas['Source'];
type Role = NonNullable<Colour['role']>;
const ROLES: [Role, string][] = [['primary', 'Primary'], ['secondary', 'Secondary'], ['accent', 'Accent'], ['text', 'Text'], ['background', 'Background']];
type Draft = { hex: string; role: Role | null; saved?: Colour }[];

export function VisualScreen() {
  const brandId = useBrandId()!;
  const book = useBook(brandId);
  const palette = usePalette(brandId);
  const sources = useSources(brandId);
  const facts = useFacts(brandId);
  const brand = useBrand(brandId);
  return (
    <>
      <PageHeader
        title="Visual identity"
        description={<>Prachaar needs three things to keep every post on brand: your logo, your colours and your fonts. <Link href={`/app/b/${brandId}/brand/sources`} className="text-action underline">Import your website</Link> to fill them in, or add each one below.</>}
      />
      <div className="grid gap-8">
        <Async q={book} what="logos and fonts" rows={2}>
          {(b) => {
            const logos = b.assets.filter((a) => a.kind === 'logo');
            const found = (sources.data ?? []).filter((s) => s.kind === 'upload' && s.meta.foundOnSite && !b.assets.some((a) => a.sourceId === s.id));
            const fontFacts = (b.sections.find((s) => s.key === 'visual')?.facts ?? []).filter((f) => f.field === 'fonts');
            const waiting = (facts.data ?? []).filter((f) => f.section === 'visual' && f.field === 'fonts' && (f.status === 'unverified' || f.status === 'inferred'));
            return (
              <>
                <LogoSection brandId={brandId} logos={logos} found={found} brandName={brand.data?.name ?? 'the brand'} />
                <FontSection brandId={brandId} approved={fontFacts} files={b.assets.filter((a) => a.kind === 'font')} waiting={waiting} />
              </>
            );
          }}
        </Async>
        <Async q={palette} what="palette" rows={3}>{(p) => <PaletteEditor brandId={brandId} palette={p} />}</Async>
      </div>
    </>
  );
}

/** A section title with whether Prachaar still needs it. */
function Need({ id, title, done, children }: { id: string; title: string; done: boolean; children: ReactNode }) {
  return (
    <div className="grid gap-1">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id={id} className="text-lg font-semibold">{title}</h2>
        <StatusBadge status={done ? 'approved' : 'waiting'} label={done ? 'Added' : 'Needed'} />
      </div>
      <p className="max-w-[65ch] text-sm text-muted">{children}</p>
    </div>
  );
}

const LOGO_TYPES = 'image/png,image/svg+xml,image/webp,image/jpeg,.png,.svg,.webp,.jpg,.jpeg';

function LogoSection({ brandId, logos, found, brandName }: { brandId: string; logos: Asset[]; found: Source[]; brandName: string }) {
  const id = useId();
  const client = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [owned, setOwned] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // Ticking the box is the owner saying so; without it the logo is stored with no licence and readiness asks for one.
  const rights = owned ? { owner: brandName, licence: 'Owned by the brand', commercialUse: true, paidUse: true } : {};
  const add = useMutation({
    mutationFn: async (from: Source | File) => {
      const sourceId = from instanceof File ? (await uploadFile(brandId, from)).id : from.id;
      return unwrap(api.POST('/api/brands/{brandId}/knowledge/assets', { params: { path: { brandId } }, body: { sourceId, kind: 'logo', rights } }));
    },
    onSuccess: async () => {
      setFile(null);
      if (input.current) input.current.value = '';
      await refreshAll(client, brandId);
    },
  });

  return (
    <section aria-labelledby="v-logos" className="grid gap-4">
      <Need id="v-logos" title="Logo" done={logos.length > 0}>The mark Prachaar puts on posts and videos. One is enough; a white version helps on dark photos.</Need>
      {logos.length ? (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {logos.map((l) => (
            <li key={l.id} className="panel grid gap-2 p-3">
              <LogoPreview src={l.source.downloadUrl} alt={l.variant ?? 'Logo'} />
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 font-medium break-words">{l.variant ?? 'Logo'}</span>
                <StatusBadge status={l.licensed ? 'approved' : 'unverified'} label={l.licensed ? 'Licence noted' : 'Licence missing'} />
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="panel grid gap-4 p-4">
        <label className="flex items-start gap-2.5 text-sm">
          <input type="checkbox" className="mt-0.5 size-4" checked={owned} onChange={(e) => setOwned(e.target.checked)} />
          <span>We own this logo, and Prachaar may use it in posts and paid ads.</span>
        </label>
        {found.length ? (
          <div className="grid gap-3">
            <p className="font-medium">Found on your website. Is this your logo?</p>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {found.map((s) => (
                <li key={s.id} className="grid gap-2 rounded-md border border-line p-3">
                  <LogoPreview src={s.downloadUrl} alt={`Logo found at ${s.uri}`} />
                  <p className="text-sm break-all text-muted">{s.uri}</p>
                  <button type="button" className="btn btn-secondary" disabled={add.isPending} onClick={() => add.mutate(s)}>Use this logo</button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <form className="field" onSubmit={(e) => { e.preventDefault(); if (file) add.mutate(file); }}>
          <label htmlFor={`${id}-file`} className="label">{logos.length ? 'Add another version' : found.length ? 'Or upload your logo' : 'Upload your logo'}</label>
          <div className="flex flex-wrap gap-3">
            <input ref={input} id={`${id}-file`} type="file" accept={LOGO_TYPES} className="input min-w-0 flex-1 py-1.5" aria-describedby={`${id}-hint`} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <button type="submit" className="btn btn-primary" disabled={!file || add.isPending}>{add.isPending ? 'Adding…' : 'Add logo'}</button>
          </div>
          <p id={`${id}-hint`} className="hint">A PNG or SVG file, on a transparent background if you have one. Example: ilamleaf-logo.svg</p>
        </form>
        <MutationError error={add.error} />
      </div>
    </section>
  );
}

function LogoPreview({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="grid h-36 place-items-center rounded-md bg-[color-mix(in_oklab,var(--theme-ink)_6%,transparent)] p-3">
      <img src={src} alt={alt} className="max-h-full max-w-full object-contain" />
    </div>
  );
}

function FontSection({ brandId, approved, files, waiting }: { brandId: string; approved: Fact[]; files: Asset[]; waiting: Fact[] }) {
  const id = useId();
  const client = useQueryClient();
  const [name, setName] = useState('');
  const add = useMutation({
    mutationFn: () => unwrap(api.POST('/api/brands/{brandId}/knowledge/facts', {
      params: { path: { brandId } }, body: { section: 'visual', subjectId: null, field: 'fonts', value: name.trim(), language: 'und' },
    })),
    onSuccess: async () => {
      setName('');
      await refreshAll(client, brandId);
    },
  });
  const decide = useMutation({
    mutationFn: ({ fact, ok }: { fact: string; ok: boolean }) => {
      const params = { path: { brandId, id: fact } };
      return unwrap(ok ? api.POST('/api/brands/{brandId}/knowledge/facts/{id}/approve', { params }) : api.POST('/api/brands/{brandId}/knowledge/facts/{id}/reject', { params, body: {} }));
    },
    onSuccess: () => refreshAll(client, brandId),
  });

  return (
    <section aria-labelledby="v-fonts" className="grid gap-4">
      <Need id="v-fonts" title="Fonts" done={approved.length + files.length > 0}>The typefaces your posts use. Only list fonts you hold a licence for; free Google Fonts count.</Need>
      {approved.length || files.length ? (
        <ul className="grid gap-2 sm:grid-cols-2">
          {approved.map((f) => <li key={f.id} className="panel px-4 py-3"><span className="text-sm text-muted">{f.fieldLabel}</span><p className="font-medium break-words">{Array.isArray(f.value) ? f.value.join(', ') : String(f.value)}</p></li>)}
          {files.map((f) => <li key={f.id} className="panel px-4 py-3"><span className="text-sm text-muted">Font file</span><p className="font-medium break-all">{String(f.source.meta.filename ?? f.variant ?? 'Font')}</p></li>)}
        </ul>
      ) : null}
      <div className="panel grid gap-4 p-4">
        {waiting.length ? (
          <div className="grid gap-2">
            <p className="font-medium">Found on your website. Are these your fonts?</p>
            <ul className="grid gap-2">
              {waiting.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line px-3 py-2">
                  <span className="font-medium break-words">{String(f.value)}</span>
                  <span className="flex gap-2">
                    <button type="button" className="btn btn-secondary h-9" disabled={decide.isPending} onClick={() => decide.mutate({ fact: f.id, ok: true })}>Yes, ours</button>
                    <button type="button" className="btn btn-quiet h-9" disabled={decide.isPending} onClick={() => decide.mutate({ fact: f.id, ok: false })}>Not ours</button>
                  </span>
                </li>
              ))}
            </ul>
            <MutationError error={decide.error} />
          </div>
        ) : null}
        <form className="field" onSubmit={(e) => { e.preventDefault(); if (name.trim()) add.mutate(); }}>
          <label htmlFor={`${id}-font`} className="label">Add a font by name</label>
          <div className="flex flex-wrap gap-3">
            <input id={`${id}-font`} className="input min-w-0 flex-1" value={name} maxLength={60} aria-describedby={`${id}-fhint`} onChange={(e) => setName(e.target.value)} />
            <button type="submit" className="btn btn-secondary" disabled={!name.trim() || add.isPending}><Plus className="size-4" aria-hidden /> Add font</button>
          </div>
          <p id={`${id}-fhint`} className="hint">One font at a time, as its name is written. Example: Mukta. Font files go in on <Link href={`/app/b/${brandId}/brand/sources`} className="text-action underline">Sources</Link>.</p>
        </form>
        <MutationError error={add.error} />
      </div>
    </section>
  );
}

function PaletteEditor({ brandId, palette }: { brandId: string; palette: Schemas['Palette'] }) {
  const id = useId();
  const client = useQueryClient();
  const server: Draft = palette.colours.map((c) => ({ hex: c.hex, role: c.role, saved: c }));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [hex, setHex] = useState('');
  const colours = draft ?? server;
  const validHex = /^#[0-9a-fA-F]{6}$/.test(hex.trim());

  const save = useMutation({
    mutationFn: () => unwrap(api.PUT('/api/brands/{brandId}/knowledge/palette', { params: { path: { brandId } }, body: { colours: colours.map(({ hex, role }) => ({ hex, role })) } })),
    onSuccess: async (p) => {
      client.setQueryData(['kb', brandId, 'palette'], p);
      setDraft(null);
      await refreshAll(client, brandId);
    },
  });

  return (
    <section aria-labelledby="v-pal" className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Need id="v-pal" title="Colours" done={(['primary', 'text', 'background'] as const).every((r) => palette.colours.some((c) => c.role === r))}>
          Give your main colour the role Primary, and say which colour is Text and which is Background. Prachaar checks that text stays readable.
        </Need>
        <button type="button" className="btn btn-primary" disabled={!draft || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : draft ? 'Save palette' : 'Palette saved'}
        </button>
      </div>
      <MutationError error={save.error} />
      <LiveStatus message={save.isSuccess && !draft ? 'Palette saved.' : ''} />

      {colours.length ? (
        <ul aria-label="Colours" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {colours.map((c, i) => {
            const s = c.saved;
            return (
              <li key={`${c.hex}-${i}`} className="panel grid overflow-hidden">
                <div className="h-20 border-b border-line" style={{ backgroundColor: c.hex }} role="img" aria-label={`Swatch ${c.hex}`} />
                <div className="grid gap-3 p-3.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="num font-mono text-base font-semibold uppercase">{c.hex}</span>
                    <span className="text-xs text-muted">{s ? `${s.origin}${s.share !== null ? `, ${Math.round(s.share * 100)}%` : ''}` : 'new'}</span>
                  </div>
                  {s ? (
                    <p className="num text-sm text-muted">
                      RGB {s.rgb.r} {s.rgb.g} {s.rgb.b}<br />
                      CMYK {s.cmyk.c} {s.cmyk.m} {s.cmyk.y} {s.cmyk.k} <span className="whitespace-nowrap">(approximate)</span>
                    </p>
                  ) : <p className="text-sm text-muted">RGB and CMYK appear after saving.</p>}
                  <div className="flex items-end gap-2">
                    <div className="field flex-1">
                      <label htmlFor={`${id}-r${i}`} className="label">Role of {c.hex}</label>
                      <select
                        id={`${id}-r${i}`} className="input" value={c.role ?? ''}
                        onChange={(e) => setDraft(colours.map((x, j) => (j === i ? { ...x, role: (e.target.value || null) as Role | null } : x)))}
                      >
                        <option value="">No role</option>
                        {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </div>
                    <button type="button" className="btn btn-quiet px-2.5" aria-label={`Remove ${c.hex}`} onClick={() => setDraft(colours.filter((_, j) => j !== i))}>
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <StateBlock state="empty" size="inline" title="No colours yet">Import your website and logo on Sources, or add a colour below.</StateBlock>
      )}

      <form className="field" onSubmit={(e) => { e.preventDefault(); if (validHex) { setDraft([...colours, { hex: hex.trim(), role: null }]); setHex(''); } }}>
        <label htmlFor={`${id}-hex`} className="label">Add a colour</label>
        <div className="flex flex-wrap gap-2">
          <input id={`${id}-hex`} className="input num w-40 font-mono" value={hex} maxLength={7} aria-invalid={!!hex && !validHex} aria-describedby={`${id}-hhint`} onChange={(e) => setHex(e.target.value)} />
          <input type="color" className="input h-auto w-12 cursor-pointer p-1" aria-label="Pick the colour" value={validHex ? hex.trim().toLowerCase() : '#000000'} onChange={(e) => setHex(e.target.value)} />
          <button type="submit" className="btn btn-secondary" disabled={!validHex}><Plus className="size-4" aria-hidden /> Add</button>
        </div>
        <p id={`${id}-hhint`} className="hint">Its hex code from your brand guide, or pick it. Example: #0f5257</p>
      </form>

      <section aria-labelledby="v-con" className="grid gap-3 pt-2">
        <h3 id="v-con" className="text-base font-semibold">Contrast of text on background</h3>
        {draft ? <p className="text-sm text-muted">Save the palette to check the new roles.</p> : null}
        {palette.contrasts.length ? (
          <ul aria-label="Contrast pairs" className="grid gap-2 sm:grid-cols-2">
            {palette.contrasts.map((c) => (
              <li key={`${c.text}-${c.background}`} className="panel flex items-center gap-3 p-3">
                <span className="grid size-12 shrink-0 place-items-center rounded-md border border-line text-lg font-semibold" style={{ backgroundColor: c.background, color: c.text }} aria-hidden>Aa</span>
                <div className="grid min-w-0 gap-0.5">
                  <p className="num text-sm"><span className="font-mono uppercase">{c.text}</span> on <span className="font-mono uppercase">{c.background}</span></p>
                  <p className="text-sm"><span className="num text-lg font-semibold">{c.ratio.toFixed(2)}:1</span>{' '}
                    <span className={c.aa ? 'text-success' : 'text-danger'}>{c.aa ? 'Passes AA' : c.aaLarge ? 'Large text only' : 'Fails AA'}</span></p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <StateBlock state="empty" size="inline" title="Nothing to compare yet">Give one colour the role Text and one the role Background.</StateBlock>
        )}
      </section>
    </section>
  );
}
