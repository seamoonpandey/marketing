import { parse } from 'node-html-parser';
import sharp from 'sharp';

const MAX_SIDE = 256;
/** Colours closer than this (RGB distance) are one colour: anti-aliasing and compression noise. */
const MERGE_DISTANCE = 24;
const MIN_SHARE = 0.01;
const MAX_COLOURS = 8;

const hexOf = (rgb: number) => `#${rgb.toString(16).padStart(6, '0')}`;
const dist2 = (a: number, b: number) =>
  ((a >> 16) - (b >> 16)) ** 2 + (((a >> 8) & 255) - ((b >> 8) & 255)) ** 2 + ((a & 255) - (b & 255)) ** 2;

/**
 * The dominant colours of an image (PNG, JPEG, WebP or SVG, which is rasterised), largest share
 * first: pixels with alpha under 128 are ignored, near-identical colours merge into the most common
 * one (so every hex is a real pixel colour, never an average), and colours under 1% are dropped.
 * 1 to 8 colours; empty only when no pixel is opaque.
 */
export async function extractPalette(image: Uint8Array): Promise<{ hex: string; share: number }[]> {
  // Nearest-neighbour downscaling keeps exact colours; any other kernel blends new ones.
  const { data, info } = await sharp(image, { density: 300 })
    .ensureAlpha()
    .resize(MAX_SIDE, MAX_SIDE, { fit: 'inside', withoutEnlargement: true, kernel: 'nearest' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const counts = new Map<number, number>();
  let total = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i + 3]! < 128) continue;
    const rgb = (data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!;
    counts.set(rgb, (counts.get(rgb) ?? 0) + 1);
    total++;
  }
  if (!total) return [];

  const clusters: { rgb: number; count: number }[] = [];
  for (const [rgb, count] of [...counts].sort((a, b) => b[1] - a[1])) {
    const near = clusters.find((c) => dist2(c.rgb, rgb) <= MERGE_DISTANCE ** 2);
    if (near) near.count += count;
    else clusters.push({ rgb, count });
  }
  clusters.sort((a, b) => b.count - a.count);
  const kept = clusters.filter((c) => c.count / total >= MIN_SHARE).slice(0, MAX_COLOURS);
  return (kept.length ? kept : clusters.slice(0, 1)).map((c) => ({
    hex: hexOf(c.rgb),
    share: Math.round((c.count / total) * 10_000) / 10_000,
  }));
}

/** A CSS colour as #rrggbb: hex (3, 4, 6 or 8 digits) or rgb()/rgba(). Mostly transparent or anything else: null. */
function cssHex(value: string): string | null {
  const v = value.trim().toLowerCase();
  const h = v.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/)?.[1];
  if (h) {
    const full = h.length <= 4 ? [...h].map((c) => c + c).join('') : h;
    if (full.length === 8 && parseInt(full.slice(6), 16) < 128) return null;
    return `#${full.slice(0, 6)}`;
  }
  const fn = v.match(/^rgba?\(([^)]*)\)$/)?.[1];
  if (!fn) return null; // shortcut: hsl(), oklch() and named colours are skipped; add them if sites use them.
  const parts = fn.split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const channel = (p: string) => (p.endsWith('%') ? (parseFloat(p) / 100) * 255 : parseFloat(p));
  const [r, g, b] = parts.slice(0, 3).map(channel);
  const alpha = parts[3] === undefined ? 1 : parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
  if (![r, g, b, alpha].every(Number.isFinite) || alpha < 0.5) return null;
  return hexOf((clamp(r!) << 16) | (clamp(g!) << 8) | clamp(b!));
}
const clamp = (n: number) => Math.min(255, Math.max(0, Math.round(n)));

/** The theme-color meta and the CSS colour custom properties of a page's inline styles, as hex, first seen first. */
export function cssColours(html: string): string[] {
  const root = parse(html);
  const values = root.querySelectorAll('meta[name="theme-color"]').map((m) => m.getAttribute('content') ?? '');
  const css = [
    ...root.querySelectorAll('style').map((s) => s.text),
    ...root.querySelectorAll('[style]').map((e) => e.getAttribute('style') ?? ''),
  ].join('\n');
  // The lookbehind starts a name only at its first dash; without it a run of dashes backtracks quadratically.
  for (const m of css.matchAll(/(?<![\w-])--[\w-]+\s*:\s*([^;{}]+)/g)) values.push(m[1]!);
  const hexes = values.map(cssHex).filter((h): h is string => h !== null);
  return [...new Set(hexes)].slice(0, 12);
}

export function toRgb(hex: string): { r: number; g: number; b: number } {
  const n = parseInt(cssHex(hex)!.slice(1), 16);
  return { r: n >> 16, g: (n >> 8) & 255, b: n & 255 };
}

/** Naive RGB to CMYK, in whole percentages. Approximate: print values from a brand guide override it. */
export function toCmyk(hex: string): { c: number; m: number; y: number; k: number } {
  const { r, g, b } = toRgb(hex);
  const k = 1 - Math.max(r, g, b) / 255;
  if (k === 1) return { c: 0, m: 0, y: 0, k: 100 };
  const part = (v: number) => Math.round(((1 - v / 255 - k) / (1 - k)) * 100);
  return { c: part(r), m: part(g), y: part(b), k: Math.round(k * 100) };
}

const luminance = (hex: string) => {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const { r, g, b } = toRgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

/** WCAG 2 contrast ratio, to 2 decimals. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return Math.round(((hi! + 0.05) / (lo! + 0.05)) * 100) / 100;
}
