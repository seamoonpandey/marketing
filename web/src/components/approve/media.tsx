import { TriangleAlert } from 'lucide-react';
import type { Preview } from './lib';

type Draft = NonNullable<Preview['draft']>;

/**
 * Every rendered file at its true shape: width and height come from the render, the box never
 * crops (object-contain) and never stretches (height auto). Carousel slides are listed in order.
 */
export function Media({ d }: { d: Draft }) {
  const groups = new Map<string, Draft['renders']>();
  for (const r of d.renders) groups.set(r.ratio, [...(groups.get(r.ratio) ?? []), r]);
  const { slides, scenes } = d.content;
  return (
    <div className="grid gap-6">
      {[...groups].map(([ratio, list]) => {
        const sorted = [...list].sort((a, b) => a.index - b.index);
        return (
          <section key={ratio} aria-label={`Size ${ratio}`} className="grid gap-3">
            {groups.size > 1 || sorted.length > 1 ? <h3 className="text-sm font-semibold">Size {ratio} <span className="font-normal text-muted">· {sorted[0]!.width} × {sorted[0]!.height}</span></h3> : null}
            <ol className="flex flex-wrap items-start gap-4">
              {sorted.map((r) => {
                const text = r.type === 'video' ? scenes.map((s) => s.onScreenText).join(', ') : slides[r.index]?.headline;
                const label = r.type === 'video' ? `Video, size ${ratio}` : sorted.length > 1 ? `Slide ${r.index + 1} of ${sorted.length}, size ${ratio}` : `Image, size ${ratio}`;
                const alt = text ? `${label}. Text: ${text}` : label;
                return (
                  <li key={`${r.type}-${r.index}`} className="grid gap-1.5" style={{ width: `min(100%, ${r.width >= r.height ? 28 : 18}rem)` }}>
                    <figure className="grid gap-1.5">
                      {r.type === 'video' ? (
                        <video src={r.url} controls preload="metadata" width={r.width} height={r.height} aria-label={alt} className="h-auto w-full rounded-md border border-line bg-panel" />
                      ) : (
                        <img src={r.url} alt={alt} width={r.width} height={r.height} className="h-auto w-full rounded-md border border-line bg-panel object-contain" />
                      )}
                      {sorted.length > 1 ? <figcaption className="num text-xs text-muted">Slide {r.index + 1} of {sorted.length}</figcaption> : null}
                    </figure>
                    {r.overflow ? <p className="flex items-start gap-1.5 text-xs text-danger"><TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />The text may not fit at this size.</p> : null}
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}
    </div>
  );
}
