import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import type { Slide } from '../index.ts';

export type Layer = { input: Buffer; left: number; top: number };
export type Ctx = {
  slide: Slide;
  W: number;
  H: number;
  /** the short side: every size in a layout is a fraction of it */
  s: number;
  m: number;
  land: boolean;
  /** y where content may start (below the logo box when there is one) */
  top: number;
  c: { bg: string; text: string; primary: string; accent: string };
};
export type Result = { layers: Layer[]; overflow: boolean };
export type Item = { input: Buffer; w: number; h: number; gap?: number };

const FONT_DIR = fileURLToPath(new URL('../../../assets/fonts/', import.meta.url));
let fontsReady: Promise<unknown> | undefined;
/** Registers the bundled files with fontconfig (once per process) so Pango finds them by family and falls back to Devanagari. */
export function loadFonts(): Promise<unknown> {
  fontsReady ??= Promise.all(
    ['NotoSans-Regular', 'NotoSans-Bold', 'NotoSansDevanagari-Regular', 'NotoSansDevanagari-Bold'].map((f) =>
      sharp({ text: { text: 'a', fontfile: `${FONT_DIR}${f}.ttf` } }).png().toBuffer(),
    ),
  );
  return fontsReady;
}

export function hex(c: string): string {
  const h = c.trim().replace('#', '');
  const f = h.length === 3 ? [...h].map((x) => x + x).join('') : h.slice(0, 6);
  return /^[0-9a-f]{6}$/i.test(f) ? `#${f.toLowerCase()}` : '#000000';
}
const rgb = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
export function mix(a: string, b: string, t: number): string {
  const [x, y] = [rgb(a), rgb(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i]! - v) * t).toString(16).padStart(2, '0')).join('')}`;
}
const lum = (c: string) => {
  const [r, g, b] = rgb(c).map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const ratio = (a: string, b: string) => {
  const [hi, lo] = [Math.max(lum(a), lum(b)), Math.min(lum(a), lum(b))];
  return (hi + 0.05) / (lo + 0.05);
};
/** The most readable of the candidates on a fill. */
export const readableOn = (fill: string, ...cands: string[]) =>
  [...cands, '#ffffff', '#000000'].reduce((best, c) => (ratio(c, fill) > ratio(best, fill) ? c : best));

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

type TextOpts = { size: number; min: number; width: number; maxH: number; color: string; bold?: boolean; leading?: number; cap?: number };

async function draw(str: string, size: number, o: TextOpts) {
  const { data, info } = await sharp({
    text: {
      text: `<span foreground="${o.color}">${esc(str.replace(/\s—\s/g, '\u00A0— ').replace(/ (\S+)$/, '\u00A0$1'))}</span>`,
      font: `Noto Sans${o.bold ? ' Bold' : ''} ${size}`,
      ...(o.width ? { width: Math.round(o.width) } : {}),
      dpi: 72,
      rgba: true,
      wrap: 'word-char',
      spacing: Math.round(size * (o.leading ?? 0)),
    },
  })
    .png()
    .toBuffer({ resolveWithObject: true });
  return { input: data, w: info.width, h: info.height };
}

/** Wraps and shrinks step by step down to `min`; if it still does not fit, keeps the whole lines that do and flags overflow. */
export async function fitText(str: string, o: TextOpts): Promise<Item & { overflow: boolean }> {
  await loadFonts();
  const maxH = Math.min(o.maxH, o.cap ?? Infinity);
  const word = str.split(/\s+/).reduce((a, w) => (w.length > a.length ? w : a), '');
  // a single word wider than the box would be broken mid-word, which counts as not fitting
  const fits = async (size: number, t: Item) => t.h <= maxH && (await draw(word, size, { ...o, width: 0 })).w <= o.width;
  let size = Math.round(o.size);
  let t = await draw(str, size, o);
  while (!(await fits(size, t)) && size > Math.round(o.min)) {
    size = Math.max(Math.round(o.min), Math.floor(size * 0.9));
    t = await draw(str, size, o);
  }
  if (await fits(size, t)) return { ...t, overflow: false };
  const line = (await draw('Ag\u0939\u093f', size, { ...o, width: 0 })).h; // one line's height at this size
  const cropH = Math.min(Math.max(line, Math.floor(maxH / line) * line), t.h);
  return { input: await sharp(t.input).extract({ left: 0, top: 0, width: t.w, height: cropH }).png().toBuffer(), w: t.w, h: cropH, overflow: true };
}

const svg = (w: number, h: number, body: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`);

export const pill = (w: number, h: number, fill: string) =>
  svg(w, h, `<rect width="${w}" height="${h}" rx="${h / 2}" fill="${fill}"/>`);
export const rect = (w: number, h: number, fill: string, op = 1, r = 0) =>
  svg(w, h, `<rect width="${w}" height="${h}" rx="${r}" fill="${fill}" fill-opacity="${op}"/>`);
export const disc = (d: number, fill: string, op: number) =>
  svg(d, d, `<circle cx="${d / 2}" cy="${d / 2}" r="${d / 2}" fill="${fill}" fill-opacity="${op}"/>`);

/** The photo cropped to cover w×h, with rounded corners (r = h/2 and w = h gives a circle). */
export async function photoFrame(photo: Uint8Array, w: number, h: number, r: number): Promise<Buffer> {
  w = Math.round(w);
  h = Math.round(h);
  return sharp(photo)
    .rotate()
    .resize(w, h, { fit: 'cover' })
    .ensureAlpha()
    .composite([{ input: rect(w, h, '#000', 1, r), blend: 'dest-in' }])
    .png()
    .toBuffer();
}

/** A full-bleed photo with the background colour fading in over the text side, so the text keeps its contrast. */
export async function bleed(c: Ctx): Promise<Layer[]> {
  const { W, H, land } = c;
  const [x2, y2] = land ? [1, 0] : [0, 1];
  const [a, b] = land ? [0.2, 0.62] : [0.2, 0.55];
  const fade = svg(W, H, `<defs><linearGradient id="g" x1="0" y1="0" x2="${x2}" y2="${y2}">
    <stop offset="${a}" stop-color="${c.c.bg}" stop-opacity="${land ? 0.96 : 0}"/>
    <stop offset="${b}" stop-color="${c.c.bg}" stop-opacity="${land ? 0.78 : 0.92}"/>
    <stop offset="1" stop-color="${c.c.bg}" stop-opacity="${land ? 0 : 0.97}"/></linearGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#g)"/>`);
  const photo = await sharp(c.slide.photo!).rotate().resize(W, H, { fit: 'cover' }).png().toBuffer();
  return [
    { input: photo, left: 0, top: 0 },
    { input: fade, left: 0, top: 0 },
  ];
}

/** Soft brand shapes for layouts without a photo. */
export function decor(c: Ctx): Layer[] {
  const d = Math.round(c.s * 0.9);
  const sm = Math.round(c.s * 0.34);
  return [
    { input: disc(d, c.c.primary, 0.1), left: Math.round(c.W - d * 0.55), top: Math.round(c.H - d * 0.55) },
    { input: disc(sm, c.c.accent, 0.16), left: Math.round(c.W - sm * 0.62), top: Math.round(c.top - sm * 0.1) },
  ];
}

/** Stacks items top to bottom at x, centred (or bottom-anchored) in [y0, y1]. */
export function stack(items: Item[], x: number, y0: number, y1: number, anchor: 'center' | 'bottom' | 'top' = 'center'): Layer[] {
  const total = items.reduce((t, i, n) => t + i.h + (n ? (i.gap ?? 0) : 0), 0);
  let y = anchor === 'bottom' ? y1 - total : anchor === 'top' ? y0 : y0 + (y1 - y0 - total) / 2;
  y = Math.max(y0, y);
  return items.map((i, n) => {
    if (n) y += i.gap ?? 0;
    const l = { input: i.input, left: Math.round(x), top: Math.round(y) };
    y += i.h;
    return l;
  });
}
