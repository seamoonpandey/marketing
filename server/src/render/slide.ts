import sharp from 'sharp';
import { SIZES, type BrandKit, type Ratio, type Slide } from './index.ts';
import { headline } from './templates/headline.ts';
import { hex, loadFonts, rect, type Ctx, type Layer } from './templates/kit.ts';
import { offer } from './templates/offer.ts';
import { quote } from './templates/quote.ts';

const TEMPLATES = { headline, offer, quote };

export async function renderSlide(
  slide: Slide,
  kit: BrandKit,
  ratio: Ratio,
): Promise<{ png: Uint8Array; width: number; height: number; overflow: boolean }> {
  await loadFonts();
  const { width: W, height: H } = SIZES[ratio];
  const s = Math.min(W, H);
  const m = Math.round(s * 0.08);
  const k = kit.colours;
  const c: Ctx = {
    slide, W, H, s, m, land: W > H, top: m,
    c: { bg: hex(k.background), text: hex(k.text), primary: hex(k.primary), accent: hex(k.accent ?? k.primary) },
  };

  // the logo box: one corner, one size, at every ratio; the logo is fitted inside it, never stretched
  const logoLayers: Layer[] = [];
  if (kit.logo) {
    const [bw, bh] = [Math.round(s * 0.3), Math.round(s * 0.09)];
    const fitted = await sharp(kit.logo).resize(bw, bh, { fit: 'inside' }).png().toBuffer({ resolveWithObject: true });
    const pad = Math.round(s * 0.015);
    const top = m + Math.round((bh - fitted.info.height) / 2);
    if (slide.photo) {
      const [pw, ph] = [fitted.info.width + 2 * pad, fitted.info.height + 2 * pad];
      logoLayers.push({ input: rect(pw, ph, c.c.bg, 0.88, pad), left: m - pad, top: top - pad });
    }
    logoLayers.push({ input: fitted.data, left: m, top });
    c.top = m + bh + Math.round(s * 0.04);
  }

  const { layers, overflow } = await TEMPLATES[slide.template](c);
  const png = await sharp({ create: { width: W, height: H, channels: 3, background: c.c.bg } })
    .composite([...layers, ...logoLayers])
    .png()
    .toBuffer();
  return { png, width: W, height: H, overflow };
}
