'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { Async, MutationError, PageHeader, StateBlock, StatusBadge, useBrandId } from '@/components/app';
import { api, unwrap, type Schemas } from '@/lib/api/client';
import { refreshAll, useBook, usePalette } from './data';

type Colour = Schemas['PaletteColour'];
type Role = NonNullable<Colour['role']>;
const ROLES: [Role, string][] = [['primary', 'Primary'], ['secondary', 'Secondary'], ['accent', 'Accent'], ['text', 'Text'], ['background', 'Background']];
type Draft = { hex: string; role: Role | null; saved?: Colour }[];

export function VisualScreen() {
  const brandId = useBrandId()!;
  const book = useBook(brandId);
  const palette = usePalette(brandId);
  return (
    <>
      <PageHeader title="Visual identity" description="The logos, the colours and the roles they play, and the fonts. The roles decide which colour is text, which is background and which carries the brand." />
      <div className="grid gap-6">
        <Async q={book} what="logos and fonts" rows={2}>
          {(b) => {
            const logos = b.assets.filter((a) => a.kind === 'logo');
            const fonts = b.assets.filter((a) => a.kind === 'font');
            const fontFacts = (b.sections.find((s) => s.key === 'visual')?.facts ?? []).filter((f) => /font|typeface/i.test(f.field));
            return (
              <>
                <section aria-labelledby="v-logos" className="grid gap-3">
                  <h2 id="v-logos" className="text-lg font-semibold">Logos</h2>
                  {logos.length ? (
                    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {logos.map((l) => (
                        <li key={l.id} className="panel grid gap-2 p-3">
                          <div className="grid h-36 place-items-center rounded-md bg-[color-mix(in_oklab,var(--theme-ink)_6%,transparent)] p-3">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={l.source.downloadUrl} alt={`${l.variant ?? 'Logo'}`} className="max-h-full max-w-full object-contain" />
                          </div>
                          <div className="flex items-center justify-between gap-2 text-sm">
                            <span className="min-w-0 font-medium break-words">{l.variant ?? 'Logo'}</span>
                            <StatusBadge status={l.licensed ? 'approved' : 'unverified'} label={l.licensed ? 'Licence noted' : 'Licence missing'} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <StateBlock state="empty" size="inline" title="No logo yet">Upload one on Sources and mark it as a logo. White-on-transparent versions are fine.</StateBlock>
                  )}
                </section>
                <section aria-labelledby="v-fonts" className="grid gap-3">
                  <h2 id="v-fonts" className="text-lg font-semibold">Fonts</h2>
                  {fonts.length || fontFacts.length ? (
                    <ul className="grid gap-2">
                      {fontFacts.map((f) => <li key={f.id} className="panel px-4 py-3" lang={f.language}><span className="text-sm text-muted">{f.fieldLabel}</span><p className="font-medium break-words">{Array.isArray(f.value) ? f.value.join(', ') : String(f.value)}</p></li>)}
                      {fonts.map((f) => <li key={f.id} className="panel px-4 py-3"><span className="text-sm text-muted">Font file</span><p className="font-medium break-all">{String(f.source.meta.filename ?? f.variant ?? 'Font')}</p></li>)}
                    </ul>
                  ) : (
                    <StateBlock state="empty" size="inline" title="No fonts yet">Fonts the brand guide names appear here once approved. Font files go in on Sources.</StateBlock>
                  )}
                </section>
              </>
            );
          }}
        </Async>
        <Async q={palette} what="palette" rows={3}>{(p) => <PaletteEditor brandId={brandId} palette={p} />}</Async>
      </div>
    </>
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="v-pal" className="text-lg font-semibold">Palette</h2>
        <button type="button" className="btn btn-primary" disabled={!draft || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : draft ? 'Save palette' : 'Palette saved'}
        </button>
      </div>
      <MutationError error={save.error} />

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
        <StateBlock state="empty" size="inline" title="No colours yet">Import the logo and website, or add a colour below.</StateBlock>
      )}

      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (validHex) { setDraft([...colours, { hex: hex.trim(), role: null }]); setHex(''); } }}>
        <div className="field">
          <label htmlFor={`${id}-hex`} className="label">Add a colour</label>
          <input id={`${id}-hex`} className="input num w-40 font-mono" value={hex} placeholder="#0f5257" maxLength={7} aria-invalid={!!hex && !validHex} onChange={(e) => setHex(e.target.value)} />
        </div>
        <button type="submit" className="btn btn-secondary" disabled={!validHex}><Plus className="size-4" aria-hidden /> Add</button>
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
