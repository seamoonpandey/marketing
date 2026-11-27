import sharp from 'sharp';
import { decor, fitText, photoFrame, stack, type Ctx, type Item, type Layer, type Result } from './kit.ts';

export async function quote(c: Ctx): Promise<Result> {
  const { s, m, W, H, land, slide, c: col } = c;
  const width = land ? W * 0.72 : W - 2 * m;
  const [y0, y1] = [c.top, H - m];
  const avail = y1 - y0;
  const avatar = slide.photo ? Math.round(s * 0.13) : 0;
  const sub = slide.subline
    ? await fitText(`— ${slide.subline}`, { size: s * 0.045, min: s * 0.03, width: width - (avatar ? avatar + s * 0.03 : 0), maxH: avail * 0.2, color: col.primary, bold: true, leading: 0.1 })
    : undefined;
  const mark = await fitText('“', { size: s * 0.3, min: s * 0.3, width: s, maxH: s, color: col.accent, bold: true });
  // trim the glyph's blank line box so the stack spacing is the glyph's own
  const { data: markImg, info: mi } = await sharp(mark.input).trim().png().toBuffer({ resolveWithObject: true });
  const markH = mi.height;
  const rowH = sub ? Math.max(sub.h, avatar) : 0;
  const head = await fitText(slide.headline, {
    size: s * 0.082, min: s * 0.055, width, bold: true, color: col.text, leading: 0.03, cap: s * 0.55,
    maxH: avail - markH - rowH - s * 0.1,
  });
  const items: Item[] = [
    { input: markImg, w: mi.width, h: markH },
    { ...head, gap: s * 0.02 },
    ...(sub ? [{ input: Buffer.alloc(0), w: 0, h: rowH, gap: s * 0.045 }] : []),
  ];
  const placed = stack(items, m, y0, y1);
  const layers: Layer[] = [...decor(c), ...placed.filter((l) => l.input.length)];
  if (sub) {
    const rowTop = placed[2]!.top;
    let x = m;
    if (avatar) {
      layers.push({ input: await photoFrame(slide.photo!, avatar, avatar, avatar / 2), left: x, top: rowTop + Math.round((rowH - avatar) / 2) });
      x += avatar + s * 0.03;
    }
    layers.push({ input: sub.input, left: Math.round(x), top: rowTop + Math.round((rowH - sub.h) / 2) });
  }
  return { layers, overflow: head.overflow || !!sub?.overflow };
}
