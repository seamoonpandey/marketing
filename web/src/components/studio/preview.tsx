'use client';

import { TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { StateBlock } from '@/components/app';
import type { DraftView } from './lib';

type Render = DraftView['renders'][number];

/** The rendered files of the current version, by size. Every file keeps its own aspect ratio. */
export function Preview({ view }: { view: DraftView }) {
  const ratios = [...new Set(view.renders.map((r) => r.ratio))];
  const [picked, setPicked] = useState<string | null>(null);
  const ratio = picked && ratios.includes(picked as Render['ratio']) ? picked : ratios[0];
  const kind = view.draft.kind;

  if (kind === 'post') {
    return <StateBlock state="empty" size="inline" title="A text post has no picture">It is posted as the copy alone. Edit the copy on the right.</StateBlock>;
  }
  if (!ratio) {
    return (
      <StateBlock state="empty" title="Not rendered yet">
        {kind === 'video' ? 'Render draws each scene as a card and joins them into a video.' : 'Render draws the picture from the brand’s template.'} It costs no model money. The current text has no render, which blocks Mark ready.
      </StateBlock>
    );
  }
  const shown = view.renders.filter((r) => r.ratio === ratio).sort((a, b) => a.index - b.index);
  const videos = shown.filter((r) => r.type === 'video');
  const images = shown.filter((r) => r.type === 'image');
  const total = images.length;

  return (
    <section aria-label="Rendered previews" className="grid gap-3">
      <div role="group" aria-label="Size" className="flex flex-wrap gap-1.5">
        {ratios.map((r) => {
          const one = view.renders.find((x) => x.ratio === r)!;
          return (
            <button key={r} type="button" aria-pressed={r === ratio} onClick={() => setPicked(r)} className={`btn ${r === ratio ? 'btn-primary' : 'btn-secondary'}`}>
              {r}<span className="num font-normal opacity-80">{one.width} × {one.height}</span>
            </button>
          );
        })}
      </div>
      {videos.map((v) => (
        <figure key={`v${v.index}`} className="grid gap-1.5">
          {/* A video has no captions track: the scene text is the script, beside it. */}
          <video controls preload="metadata" width={v.width} height={v.height} src={v.url} aria-label={`Video, ${v.ratio}`} style={fit(v)} className="rounded-md border border-line bg-inv-bg" />
          <Caption r={v} label="Video" />
        </figure>
      ))}
      <ul className="grid gap-4">
        {images.map((r) => (
          <li key={r.index}>
            <figure className="grid gap-1.5">
              <img
                src={r.url}
                width={r.width}
                height={r.height}
                alt={`${view.draft.kind === 'video' ? 'Scene' : 'Slide'} ${r.index + 1} of ${total} at ${r.ratio}`}
                style={fit(r)} className="rounded-md border border-line bg-surface"
              />
              <Caption r={r} label={total > 1 ? `${view.draft.kind === 'video' ? 'Scene' : 'Slide'} ${r.index + 1} of ${total}` : 'Image'} />
            </figure>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The column's full width, up to the point where the file would be taller than 80% of the screen; width and height always keep the file's ratio. */
const fit = (r: Render) => ({ width: '100%', height: 'auto', aspectRatio: `${r.width} / ${r.height}`, maxWidth: `min(100%, calc(80vh * ${r.width / r.height}))` });

function Caption({ r, label }: { r: Render; label: string }) {
  return (
    <figcaption className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
      <span className="font-medium text-ink">{label}</span>
      <span className="num">{r.ratio} · {r.width} × {r.height} px</span>
      {r.overflow ? <span className="inline-flex items-center gap-1 font-medium text-danger"><TriangleAlert className="size-3.5" aria-hidden />Text does not fit</span> : null}
    </figcaption>
  );
}
