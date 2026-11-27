'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, CircleCheck, Film, ImageIcon, Info, Plus, Save, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useEffectEvent, useRef, useState, type MutableRefObject } from 'react';
import { Async, BackLink, MoneyText, MutationError, PageHeader, RunProgress, StateBlock, StatusBadge, useBrandId } from '@/components/app';
import { api, unwrap, type Schemas } from '@/lib/api/client';
import { Preview } from './preview';
import { CHECK_LABEL, LANGUAGE_LABEL, NO_COST, cancelRun, fetchRun, retryRun, runKey, useAct, useAssets, useDraft, useTemplates, whyUnavailable, type Asset, type DraftView, type Ratio, type Template } from './lib';
import { label } from '@/lib/labels';

type Sentence = Schemas['StudioSentence'];
// The contract's bounds: a carousel has 2 to 10 slides, a video 1 to 10 scenes, a caption at most 30 sentences.
const SLIDES = { min: 2, max: 10 };
const SCENES = { min: 1, max: 10 };
const SENTENCES = { min: 1, max: 30 };
type Form = {
  copies: { language: string; sentences: Sentence[]; hashtags: string; cta: string }[];
  slides: Schemas['StudioSlideText'][];
  scenes: Schemas['StudioScene'][];
  template: Template;
  ratios: Ratio[];
};

const toForm = (v: DraftView): Form => ({
  copies: [
    ...v.content.copies.map((c) => ({ language: c.language, sentences: c.sentences, hashtags: (c.hashtags ?? []).join(' '), cta: c.cta ?? '' })),
    ...v.missingLanguages.map((language) => ({ language, sentences: [{ text: '', claim: false, factIds: [] }], hashtags: '', cta: '' })),
  ],
  slides: v.content.slides,
  scenes: v.content.scenes,
  template: v.content.template,
  ratios: v.content.ratios,
});

const toPatch = (f: Form, baseVersion: number): Schemas['StudioContentPatch'] => ({
  copies: f.copies
    .map((c) => ({
      language: c.language,
      sentences: c.sentences.filter((s) => s.text.trim()).map((s) => ({ ...s, text: s.text.trim() })),
      hashtags: c.hashtags.split(/[\s,]+/).map((h) => h.replace(/^#/, '')).filter(Boolean),
      cta: c.cta.trim(),
    }))
    .filter((c) => c.sentences.length > 0),
  ...(f.slides.length ? { slides: f.slides } : {}),
  ...(f.scenes.length ? { scenes: f.scenes } : {}),
  template: f.template,
  ratios: f.ratios,
  baseVersion,
});

export function DraftEditor() {
  const brandId = useBrandId()!;
  const { draftId } = useParams<{ draftId: string }>();
  const q = useDraft(brandId, draftId);
  return <Async q={q} what="draft">{(v) => <Screen brandId={brandId} v={v} />}</Async>;
}

function Screen({ brandId, v }: { brandId: string; v: DraftView }) {
  const id = v.draft.id;
  const [dirty, setDirty] = useState(false);
  const save = useRef<(() => void) | null>(null);
  const render = useAct(brandId, () => unwrap(api.POST('/api/brands/{brandId}/studio/drafts/{id}/render', { params: { path: { brandId, id } } })));
  const ready = useAct(brandId, () => unwrap(api.POST('/api/brands/{brandId}/studio/drafts/{id}/ready', { params: { path: { brandId, id } } })));
  const [renderRun, setRenderRun] = useState<string | null>(v.latestRun?.kind === 'render' && v.latestRun.state === 'running' ? v.latestRun.id : null);
  const visual = v.draft.kind !== 'post';
  const isReady = v.draft.status === 'ready';
  const reason = dirty ? 'Save your changes first: Ready applies to a saved version.' : v.cannotMarkReadyReason ?? 'Something still blocks this draft.';
  const canReady = !dirty && v.canMarkReady && !isReady;
  const title = v.planItem?.idea ?? `${label(v.channel)} ${label(v.draft.kind).toLowerCase()}`;
  const blocking = v.findings.filter((f) => f.blocking);

  return (
    <>
      <BackLink href={`/app/b/${brandId}/studio${v.weekStart ? `?week=${v.weekStart}` : ''}`}>Back to Studio</BackLink>
      <PageHeader
        title={title}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{label(v.channel)} · {label(v.draft.kind)}</span>
            <span className="num">Version {v.version.version}, written by {v.version.origin === 'model' ? 'the model' : 'you'}</span>
            <StatusBadge status={isReady ? 'completed' : 'draft'} label={isReady ? `Ready as version ${v.draft.readyVersion}` : undefined} />
          </span>
        }
        actions={
          <>
            {visual ? (
              <button type="button" className="btn btn-secondary" disabled={render.isPending || dirty || !!renderRun} onClick={() => render.mutate(undefined, { onSuccess: (r) => setRenderRun(r.id) })}>
                <Film className="size-4" aria-hidden />Render <MoneyText value={NO_COST} />
              </button>
            ) : null}
            <button type="button" className="btn btn-secondary" disabled={!dirty} onClick={() => save.current?.()}><Save className="size-4" aria-hidden />Save changes</button>
            <button type="button" className="btn btn-primary" disabled={!canReady || ready.isPending} aria-describedby="ready-reason" onClick={() => ready.mutate()}>
              <CircleCheck className="size-4" aria-hidden />{isReady ? 'Marked ready' : ready.isPending ? 'Marking…' : 'Mark ready'}
            </button>
          </>
        }
      />
      <div className="mb-5 grid gap-2">
        <p id="ready-reason" className={`text-sm ${canReady || isReady ? 'text-muted' : 'font-medium text-danger'}`}>
          {isReady ? 'Ready. Editing it makes a new version and puts it back to draft.' : canReady ? 'Nothing blocks this draft. Mark it ready when you are happy with it.' : reason}
        </p>
        <MutationError error={render.error ?? ready.error} />
        {!v.planApproved ? (
          <StateBlock state="stale" size="inline" title="This plan item is no longer approved">
            {v.planItem ? 'Its week went back to draft.' : 'The plan item was deleted.'} The draft stays readable and editable, but it cannot be written again.
          </StateBlock>
        ) : null}
        {renderRun ? <RenderRun brandId={brandId} id={renderRun} onSettled={() => setRenderRun(null)} /> : null}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-2 xl:grid-cols-[minmax(0,6fr)_minmax(0,5fr)]">
        {/* The previews are the wider column, so a post can be judged by its picture; a tall set scrolls on its own beside the form. */}
        <div role="group" aria-label="Preview" tabIndex={0} className="lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto">
          <Preview view={v} />
        </div>
        <div className="grid min-w-0 gap-6">
          <Findings v={v} blockingCount={blocking.length} />
          <EditForm key={v.version.version} brandId={brandId} v={v} onDirty={setDirty} save={save} />
          <LeftOut v={v} />
        </div>
      </div>
    </>
  );
}

/** How long the "Rendering completed" strip stays before it goes by itself. */
const DISMISS_MS = 8000;

function RenderRun({ brandId, id, onSettled }: { brandId: string; id: string; onSettled: () => void }) {
  const key = runKey(brandId, id);
  const run = useQuery({ queryKey: key, queryFn: () => fetchRun(brandId, id) });
  const state = run.data?.state;
  const settled = !!state && state !== 'running' && state !== 'awaiting_approval';
  // A clean finish needs nothing from the owner, so its strip leaves by itself (a failure or a note stays until dismissed).
  const clean = state === 'completed' && !run.data?.error;
  const [held, setHeld] = useState(false);
  const client = useQueryClient();
  const dismiss = useEffectEvent(onSettled);
  useEffect(() => { if (settled) client.invalidateQueries({ queryKey: ['studio', brandId] }); }, [settled, client, brandId]);
  // Hovering or focusing the strip holds it, so it never goes while it is being read or used.
  useEffect(() => {
    if (!clean || held) return;
    const t = setTimeout(dismiss, DISMISS_MS);
    return () => clearTimeout(t);
  }, [clean, held]);
  return (
    <div
      className="grid gap-2"
      onMouseEnter={() => setHeld(true)} onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)} onBlur={() => setHeld(false)}
    >
      <RunProgress queryKey={key} fetchRun={() => fetchRun(brandId, id)} onCancel={() => cancelRun(brandId, id)} onRetry={() => retryRun(brandId, id)} label="Rendering" />
      {state === 'completed' && run.data?.error ? <StateBlock state="partial" size="inline" title="Rendered with a note">{run.data.error}</StateBlock> : null}
      {settled ? <button type="button" className="btn btn-quiet justify-self-start" onClick={onSettled}>Dismiss</button> : null}
    </div>
  );
}

function Findings({ v, blockingCount }: { v: DraftView; blockingCount: number }) {
  const sorted = [...v.findings].sort((a, b) => Number(b.blocking) - Number(a.blocking));
  return (
    <section aria-labelledby="findings-h" className="panel grid gap-3 p-4">
      <h2 id="findings-h" className="text-lg font-semibold">
        {blockingCount ? `${blockingCount} ${blockingCount === 1 ? 'thing blocks' : 'things block'} Ready` : sorted.length ? 'Nothing blocks Ready' : 'All checks pass'}
      </h2>
      {sorted.length === 0 ? <p className="text-sm text-muted">The numbers, words, length, call to action and render were checked against today’s facts and rights.</p> : (
        <ul className="grid gap-2">
          {sorted.map((f, i) => (
            <li key={i} className={`flex items-start gap-2.5 rounded-md p-2.5 ${f.blocking ? 'bg-[color-mix(in_oklab,var(--theme-danger)_9%,transparent)]' : 'bg-[color-mix(in_oklab,var(--theme-highlight)_26%,transparent)]'}`}>
              {f.blocking ? <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden /> : <Info className="mt-0.5 size-4 shrink-0" aria-hidden />}
              <div className="grid min-w-0 gap-0.5 text-sm">
                <p className="font-semibold">{CHECK_LABEL[f.check]} <span className={`text-xs font-medium ${f.blocking ? 'text-danger' : 'text-muted'}`}>{f.blocking ? 'Blocks Ready' : 'Advice only'}</span></p>
                <p className="break-words">{f.message}</p>
                <p className="text-xs text-muted break-words">In {f.where}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function LeftOut({ v }: { v: DraftView }) {
  return (
    <section aria-labelledby="left-h" className="panel grid gap-2 p-4">
      <h2 id="left-h" className="text-lg font-semibold">Left out</h2>
      {v.leftOut.length === 0 ? <p className="text-sm text-muted">Every claim in this draft cites an approved fact.</p> : (
        <>
          <p className="text-sm text-muted">These claims were removed because no approved fact backs them.</p>
          <ul className="grid gap-2">
            {v.leftOut.map((l, i) => (
              <li key={i} className="rounded-md border border-dashed border-line-strong p-2.5 text-sm">
                <p lang={l.language} className="break-words line-through decoration-1">{l.text}</p>
                <p className="text-xs text-muted">{LANGUAGE_LABEL[l.language] ?? l.language}: {l.reason}</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function factLabel(f: Schemas['StudioFactRef']): string {
  const value = f.value === undefined || f.value === null ? '' : typeof f.value === 'string' ? f.value : JSON.stringify(f.value);
  return `${f.subjectName ?? f.section} · ${f.field}${value ? `: ${value}${f.unit ? ` ${f.unit}` : ''}` : ''}`;
}

function EditForm({ brandId, v, onDirty, save }: { brandId: string; v: DraftView; onDirty: (d: boolean) => void; save: MutableRefObject<(() => void) | null> }) {
  const [initial] = useState(() => toForm(v));
  const [f, setF] = useState<Form>(initial);
  const templates = useTemplates(brandId);
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  const patch = useAct(brandId, () =>
    unwrap(api.PATCH('/api/brands/{brandId}/studio/drafts/{id}', { params: { path: { brandId, id: v.draft.id } }, body: toPatch(f, v.version.version) })),
  );
  // The header owns the Save button; this form owns the data.
  const submit = () => patch.mutate();
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  save.current = submit;
  const factFor = (id: string) => v.facts.find((x) => x.id === id);
  const visual = v.draft.kind !== 'post';
  const set = <K extends keyof Form>(k: K, val: Form[K]) => setF((s) => ({ ...s, [k]: val }));
  const upd = <T,>(list: T[], i: number, part: Partial<T>) => list.map((x, j) => (j === i ? { ...x, ...part } : x));
  const tpl = templates.data?.templates ?? (['headline', 'offer', 'quote'] as const).map((name) => ({ name, label: name[0]!.toUpperCase() + name.slice(1), description: '' }));
  const sizes = templates.data?.ratios ?? (['1:1', '4:5', '9:16', '16:9'] as const).map((ratio) => ({ ratio, label: ratio, width: 0, height: 0 }));
  const slideWord = v.draft.kind === 'static' ? 'Image' : 'Slide';

  return (
    <form
      aria-label="Edit the draft"
      className="grid gap-6"
      onSubmit={(e) => { e.preventDefault(); if (dirty) submit(); }}
    >
      {v.draft.kind === 'video' ? (
        <fieldset className="panel grid gap-3 p-4">
          <legend className="sr-only">Script</legend>
          <h2 className="text-lg font-semibold" aria-hidden>Script</h2>
          <p className="text-sm text-muted">Each scene becomes one card of the video. There is no voice: the voiceover is script text.</p>
          {f.scenes.map((s, i) => (
            <div key={i} className="grid gap-2 rounded-md border border-line p-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Scene {i + 1}</h3>
                <button type="button" className="btn btn-quiet px-2" disabled={f.scenes.length <= SCENES.min} aria-label={`Remove scene ${i + 1}`} onClick={() => set('scenes', f.scenes.filter((_, j) => j !== i))}>
                  <Trash2 className="size-4" aria-hidden />Remove
                </button>
              </div>
              <Area label={`On screen, scene ${i + 1}`} value={s.onScreenText} onChange={(t) => set('scenes', upd(f.scenes, i, { onScreenText: t }))} lang={v.languages[0]} />
              <Area label={`Voiceover, scene ${i + 1}`} value={s.voiceover} onChange={(t) => set('scenes', upd(f.scenes, i, { voiceover: t }))} lang={v.languages[0]} />
              <Area label={`Shot, scene ${i + 1}`} value={s.shot} onChange={(t) => set('scenes', upd(f.scenes, i, { shot: t }))} />
              <div className="field max-w-40">
                <label className="label" htmlFor={`sec-${i}`}>Seconds, scene {i + 1}</label>
                <input id={`sec-${i}`} type="number" min={1} max={15} step={0.5} className="input num" value={s.seconds} onChange={(e) => set('scenes', upd(f.scenes, i, { seconds: Number(e.target.value) }))} />
              </div>
            </div>
          ))}
          <button type="button" className="btn btn-secondary justify-self-start" disabled={f.scenes.length >= SCENES.max} onClick={() => set('scenes', [...f.scenes, { onScreenText: 'New scene', voiceover: '', shot: '', seconds: 3 }])}>
            <Plus className="size-4" aria-hidden />Add scene{f.scenes.length >= SCENES.max ? ` (at most ${SCENES.max})` : ''}
          </button>
        </fieldset>
      ) : null}

      {v.draft.kind === 'static' || v.draft.kind === 'carousel' ? (
        <fieldset className="panel grid gap-3 p-4">
          <legend className="sr-only">{slideWord} text</legend>
          <h2 className="text-lg font-semibold" aria-hidden>{slideWord} text</h2>
          {f.slides.map((s, i) => (
            <div key={i} className="grid gap-2 rounded-md border border-line p-3">
              {v.draft.kind === 'carousel' ? (
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">Slide {i + 1}</h3>
                  <button type="button" className="btn btn-quiet px-2" disabled={f.slides.length <= SLIDES.min} aria-label={`Remove slide ${i + 1}`} onClick={() => set('slides', f.slides.filter((_, j) => j !== i))}>
                    <Trash2 className="size-4" aria-hidden />Remove
                  </button>
                </div>
              ) : null}
              <Area label={f.slides.length > 1 ? `Headline, slide ${i + 1}` : 'Headline'} value={s.headline} onChange={(t) => set('slides', upd(f.slides, i, { headline: t }))} lang={v.languages[0]} />
              <Area label={f.slides.length > 1 ? `Subline, slide ${i + 1}` : 'Subline'} value={s.subline ?? ''} onChange={(t) => set('slides', upd(f.slides, i, { subline: t }))} lang={v.languages[0]} />
              <div className="field">
                <label className="label" htmlFor={`badge-${i}`}>{f.slides.length > 1 ? `Badge, slide ${i + 1}` : 'Badge'}</label>
                <input id={`badge-${i}`} className="input" lang={v.languages[0]} value={s.badge ?? ''} onChange={(e) => set('slides', upd(f.slides, i, { badge: e.target.value }))} />
              </div>
              <PhotoPick brandId={brandId} label={f.slides.length > 1 ? `slide ${i + 1}` : 'the image'} value={s.photoAssetId} onChange={(photoAssetId) => set('slides', upd(f.slides, i, { photoAssetId }))} />
            </div>
          ))}
          {v.draft.kind === 'carousel' ? (
            <button type="button" className="btn btn-secondary justify-self-start" disabled={f.slides.length >= SLIDES.max} onClick={() => set('slides', [...f.slides, { headline: 'New slide' }])}>
              <Plus className="size-4" aria-hidden />Add slide{f.slides.length >= SLIDES.max ? ` (at most ${SLIDES.max})` : ''}
            </button>
          ) : null}
        </fieldset>
      ) : null}

      {visual ? (
        <fieldset className="panel grid gap-4 p-4">
          <legend className="sr-only">Design</legend>
          <h2 className="text-lg font-semibold" aria-hidden>Design</h2>
          <div role="radiogroup" aria-label="Template" className="grid gap-2 sm:grid-cols-3">
            {tpl.map((t) => (
              <label key={t.name} className={`grid cursor-pointer gap-0.5 rounded-md border p-3 has-focus-visible:outline-2 has-focus-visible:outline-brand ${f.template === t.name ? 'border-brand bg-surface' : 'border-line'}`}>
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <input type="radio" name="template" className="sr-only" checked={f.template === t.name} onChange={() => set('template', t.name)} />
                  {t.label}
                </span>
                {t.description ? <span className="text-xs text-muted">{t.description}</span> : null}
              </label>
            ))}
          </div>
          <div role="group" aria-label="Sizes to render" className="flex flex-wrap gap-2">
            {sizes.map((s) => (
              <label key={s.ratio} className="flex cursor-pointer items-center gap-2 rounded-md border border-line px-3 py-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={f.ratios.includes(s.ratio)}
                  onChange={(e) => set('ratios', e.target.checked ? [...f.ratios, s.ratio] : f.ratios.filter((r) => r !== s.ratio))}
                />
                {s.label}{s.width ? <span className="num text-muted">{s.width} × {s.height}</span> : null}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {f.copies.map((c, ci) => {
        const lang = LANGUAGE_LABEL[c.language] ?? c.language;
        const setCopy = (part: Partial<typeof c>) => set('copies', upd(f.copies, ci, part));
        return (
          <fieldset key={c.language} className="panel grid gap-3 p-4">
            <legend className="sr-only">Copy in {lang}</legend>
            <h2 className="text-lg font-semibold" aria-hidden>Copy in {lang}</h2>
            {c.sentences.every((s) => !s.text) ? <p className="text-sm text-muted">The model wrote nothing in this language. Write the caption here.</p> : null}
            {c.sentences.map((s, si) => {
              const cited = (s.factIds ?? []).map((id) => ({ id, fact: factFor(id) }));
              return (
                <div key={si} className="grid gap-1.5">
                  <div className="flex items-end gap-2">
                    <div className="min-w-0 flex-1"><Area label={`Sentence ${si + 1} in ${lang}`} value={s.text} lang={c.language} onChange={(t) => setCopy({ sentences: upd(c.sentences, si, { text: t }) })} /></div>
                    <button type="button" className="btn btn-quiet px-2" disabled={c.sentences.length <= SENTENCES.min} aria-label={`Remove ${lang} sentence ${si + 1}`} onClick={() => setCopy({ sentences: c.sentences.filter((_, j) => j !== si) })}>
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  </div>
                  <ul aria-label={`Facts cited by sentence ${si + 1}`} className="flex flex-wrap gap-1.5 text-xs">
                    {s.claim ? null : <li className="rounded-full bg-[color-mix(in_oklab,var(--theme-ink)_7%,transparent)] px-2 py-0.5 text-muted">Not a claim</li>}
                    {s.claim && cited.length === 0 ? <li className="rounded-full bg-[color-mix(in_oklab,var(--theme-danger)_11%,transparent)] px-2 py-0.5 font-medium text-danger">A claim with no fact</li> : null}
                    {cited.map(({ id, fact }) => fact ? (
                      <li key={id} className="max-w-full rounded-full bg-success-bg px-2 py-0.5 break-words text-success">Fact: {factLabel(fact)}</li>
                    ) : (
                      <li key={id} className="rounded-full bg-[color-mix(in_oklab,var(--theme-danger)_11%,transparent)] px-2 py-0.5 font-medium text-danger">A cited fact is no longer approved</li>
                    ))}
                  </ul>
                </div>
              );
            })}
            <button type="button" className="btn btn-secondary justify-self-start" disabled={c.sentences.length >= SENTENCES.max} onClick={() => setCopy({ sentences: [...c.sentences, { text: '', claim: false, factIds: [] }] })}>
              <Plus className="size-4" aria-hidden />Add a sentence in {lang}
            </button>
            <div className="field">
              <label className="label" htmlFor={`cta-${ci}`}>Call to action in {lang}</label>
              <input id={`cta-${ci}`} className="input" lang={c.language} value={c.cta} onChange={(e) => setCopy({ cta: e.target.value })} />
            </div>
            <div className="field">
              <label className="label" htmlFor={`tags-${ci}`}>Hashtags in {lang}</label>
              <input id={`tags-${ci}`} className="input" lang={c.language} value={c.hashtags} onChange={(e) => setCopy({ hashtags: e.target.value })} />
              <p className="hint">Separate with spaces. No # needed.</p>
            </div>
          </fieldset>
        );
      })}

      <div className="flex flex-wrap items-center gap-3">
        {patch.isPending ? <p className="text-sm text-muted" role="status">Saving…</p> : null}
        {dirty && !patch.isPending ? <p className="text-sm text-muted" role="status">Unsaved changes. Saving makes version {v.version.version + 1}{v.draft.status === 'ready' ? ' and puts this draft back to draft' : ''}.</p> : null}
      </div>
      <MutationError error={patch.error} />
    </form>
  );
}

function Area({ label, value, onChange, lang }: { label: string; value: string; onChange: (t: string) => void; lang?: string }) {
  const id = `a-${label.replace(/\W+/g, '-')}`;
  return (
    <div className="field">
      <label className="label" htmlFor={id}>{label}</label>
      {/* field-sizing grows the box with its text, so long Devanagari lines are never clipped */}
      <textarea id={id} lang={lang} rows={1} value={value} onChange={(e) => onChange(e.target.value)} className="input field-sizing-content h-auto min-h-10 resize-y py-2 leading-normal" />
    </div>
  );
}

/** A photo for one slide, from the brand's assets. Only an asset with a live licence can be picked; the others say why not. */
function PhotoPick({ brandId, label, value, onChange }: { brandId: string; label: string; value: string | undefined; onChange: (id: string | undefined) => void }) {
  const [open, setOpen] = useState(false);
  const assets = useAssets(brandId);
  const photos = (assets.data ?? []).filter((a) => a.kind === 'photo' || a.kind === 'other');
  const chosen = (assets.data ?? []).find((a) => a.id === value);
  const name = (a: Asset) => String(a.source.meta.filename ?? a.variant ?? a.source.uri);
  const isImage = (a: Asset) => /\.(png|jpe?g|webp)$/i.test(name(a));
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="label">Photo for {label}</span>
        {value ? <span className="text-sm break-all">{chosen ? name(chosen) : 'An asset of this brand'}</span> : <span className="text-sm text-muted">None</span>}
        <button type="button" className="btn btn-secondary" aria-expanded={open} onClick={() => setOpen(!open)}><ImageIcon className="size-4" aria-hidden />{value ? 'Change photo' : 'Choose a photo'}<span className="sr-only"> for {label}</span></button>
        {value ? <button type="button" className="btn btn-quiet" onClick={() => onChange(undefined)}>Remove photo<span className="sr-only"> from {label}</span></button> : null}
      </div>
      {open ? (
        <div role="group" aria-label={`Photos for ${label}`} className="grid gap-2 rounded-md border border-line p-2">
          {assets.isPending ? <p className="text-sm text-muted">Loading the brand’s assets…</p> : null}
          {assets.isError ? <p role="alert" className="text-sm text-danger">The assets could not be loaded: {assets.error.message}</p> : null}
          {assets.data && photos.length === 0 ? <p className="text-sm text-muted">The brand has no photos yet. Add one on the <Link className="underline" href={`/app/b/${brandId}/brand/sources`}>Sources</Link> screen, with its licence.</p> : null}
          <ul className="grid gap-2 sm:grid-cols-2">
            {photos.map((a) => {
              const why = whyUnavailable(a);
              return (
                <li key={a.id} className="flex items-center gap-2.5 rounded-md border border-line p-2">
                  {isImage(a) ? (
                    // eslint-disable-next-line @next/next/no-img-element -- presigned storage URL
                    <img src={a.source.downloadUrl} alt="" className="size-12 shrink-0 rounded object-cover" />
                  ) : null}
                  <div className="grid min-w-0 flex-1 gap-0.5 text-sm">
                    <p className="font-medium break-all">{name(a)}</p>
                    {why ? <p className="text-xs text-danger">Unavailable: {why}</p> : <p className="text-xs text-muted">Licence: {a.rights.licence}</p>}
                  </div>
                  <button type="button" className="btn btn-secondary" disabled={!!why || a.id === value} onClick={() => { onChange(a.id); setOpen(false); }}>
                    {a.id === value ? 'In use' : 'Use'}<span className="sr-only"> {name(a)} for {label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
