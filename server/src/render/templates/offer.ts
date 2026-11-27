import sharp from 'sharp';
import { decor, fitText, photoFrame, pill, readableOn, stack, type Ctx, type Item, type Layer, type Result } from './kit.ts';

export async function offer(c: Ctx): Promise<Result> {
  const { s, m, W, H, land, slide, c: col } = c;
  const layers: Layer[] = [];
  const x = m;
  let width = W - 2 * m, y0 = c.top;
  const y1 = H - m;
  let badgeY: number | undefined; // set when the badge straddles the photo's lower edge

  if (slide.photo) {
    if (land) {
      const px = Math.round(W * 0.56);
      layers.push({ input: await photoFrame(slide.photo, W - m - px, H - 2 * m, s * 0.04), left: px, top: m });
      width = px - 1.6 * m;
    } else {
      const ph = Math.round(H * (H > W * 1.5 ? 0.34 : 0.36));
      layers.push({ input: await photoFrame(slide.photo, W - 2 * m, ph, s * 0.04), left: m, top: c.top });
      y0 = c.top + ph;
      badgeY = y0;
    }
  } else layers.push(...decor(c));

  const fill = col.accent;
  const ink = readableOn(fill, col.bg, col.text);
  let badge: (Item & { overflow: boolean }) | undefined;
  if (slide.badge) {
    const padX = s * 0.04;
    const t = await fitText(slide.badge, { size: s * 0.075, min: s * 0.04, width: width - 2 * padX, maxH: s * 0.2, bold: true, color: ink });
    const [w, h] = [Math.round(t.w + 2 * padX), Math.round(t.h + s * 0.03)];
    badge = { ...t, input: await pillWith(t.input, w, h, fill, padX), w, h };
  }
  const straddle = badgeY !== undefined && badge;
  if (straddle) y0 += badge!.h / 2;

  const avail = y1 - y0;
  const sub = slide.subline
    ? await fitText(slide.subline, { size: s * 0.046, min: s * 0.03, width, maxH: avail * 0.2, color: col.text, leading: 0.1 })
    : undefined;
  const used = (badge && !straddle ? badge.h + s * 0.04 : 0) + (sub ? sub.h + s * 0.035 : 0);
  const head = await fitText(slide.headline, { size: s * 0.098, min: s * 0.06, width, bold: true, color: col.text, leading: 0.02, cap: s * 0.55, maxH: avail - used - s * 0.03 });
  const items: Item[] = [
    ...(badge && !straddle ? [badge] : []),
    { ...head, gap: badge && !straddle ? s * 0.04 : 0 },
    ...(sub ? [{ ...sub, gap: s * 0.035 }] : []),
  ];
  layers.push(...stack(items, x, y0 + (straddle ? s * 0.05 : 0), y1, slide.photo && !land ? 'top' : 'center'));
  if (straddle) layers.push({ input: badge!.input, left: m + Math.round(s * 0.03), top: Math.round(badgeY! - badge!.h / 2) });
  return { layers, overflow: head.overflow || !!sub?.overflow || !!badge?.overflow };
}

/** A pill of `fill` with the text image centred inside. */
async function pillWith(text: Buffer, w: number, h: number, fill: string, padX: number): Promise<Buffer> {
  const meta = await sharp(text).metadata();
  return sharp(pill(w, h, fill))
    .composite([{ input: text, left: Math.round(padX), top: Math.round((h - meta.height!) / 2) }])
    .png()
    .toBuffer();
}
