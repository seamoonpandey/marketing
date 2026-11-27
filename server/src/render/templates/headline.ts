import { bleed, decor, fitText, rect, stack, type Ctx, type Result } from './kit.ts';

export async function headline(c: Ctx): Promise<Result> {
  const { s, m, W, H, land, slide, c: col } = c;
  const photo = !!slide.photo;
  const width = land ? W * (photo ? 0.58 : 0.7) - m : W - 2 * m;
  const [y0, y1] = [c.top, H - m];
  const avail = y1 - y0;
  const bar = Math.round(s * 0.014);
  const sub = slide.subline
    ? await fitText(slide.subline, { size: s * 0.046, min: s * 0.03, width, maxH: avail * 0.2, color: col.text, leading: 0.1 })
    : undefined;
  const head = await fitText(slide.headline, {
    size: s * 0.115, min: s * 0.06, width, bold: true, color: col.text, leading: 0.02,
    cap: s * 0.6, maxH: avail - (sub ? sub.h + s * 0.04 : 0) - bar - s * 0.05,
  });
  const barItem = { input: rect(Math.round(s * 0.13), bar, col.accent, 1, bar / 2), w: s * 0.13, h: bar };
  const items = [barItem, { ...head, gap: s * 0.05 }, ...(sub ? [{ ...sub, gap: s * 0.04 }] : [])];
  const layers = [
    ...(photo ? await bleed(c) : decor(c)),
    ...stack(items, m, y0, y1, photo ? 'bottom' : 'center'),
  ];
  return { layers, overflow: head.overflow || !!sub?.overflow };
}
