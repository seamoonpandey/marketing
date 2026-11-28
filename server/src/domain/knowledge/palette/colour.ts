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

/** A CSS colour as #rrggbb: hex (3, 4, 6 or 8 digits), rgb(), hsl() or oklch(). Mostly transparent or anything else: null. */
function cssHex(value: string): string | null {
  const v = value.trim().toLowerCase();
  const h = v.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/)?.[1];
  if (h) {
    const full = h.length <= 4 ? [...h].map((c) => c + c).join('') : h;
    if (full.length === 8 && parseInt(full.slice(6), 16) < 128) return null;
    return `#${full.slice(0, 6)}`;
  }
  const fn = v.match(/^(rgba?|hsla?|oklch)\(([^)]*)\)$/);
  if (!fn) return null; // shortcut: named colours, lab(), lch() and color-mix() are skipped; add them if sites use them.
  const parts = fn[2]!.split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const num = (p: string, whole = 1) => (p === 'none' ? 0 : p.endsWith('%') ? (parseFloat(p) / 100) * whole : parseFloat(p));
  const alpha = parts[3] === undefined ? 1 : num(parts[3]);
  const [a, b, c] = parts as [string, string, string];
  // hsl() takes its saturation and lightness as percentages, with or without the % sign.
  const rgb = fn[1]!.startsWith('rgb') ? [num(a, 255), num(b, 255), num(c, 255)]
    : fn[1]!.startsWith('hsl') ? hslRgb(hue(a), parseFloat(b) / 100, parseFloat(c) / 100)
    : oklchRgb(num(a), num(b, 0.4), hue(c));
  if (![...rgb, alpha].every(Number.isFinite) || alpha < 0.5) return null;
  return hexOf((clamp(rgb[0]!) << 16) | (clamp(rgb[1]!) << 8) | clamp(rgb[2]!));
}
const clamp = (n: number) => Math.min(255, Math.max(0, Math.round(n)));

/** A CSS hue in degrees (deg, turn, rad, grad or a bare number). */
function hue(p: string): number {
  const n = p === 'none' ? 0 : parseFloat(p);
  return p.endsWith('turn') ? n * 360 : p.endsWith('grad') ? n * 0.9 : p.endsWith('rad') ? (n * 180) / Math.PI : n;
}

function hslRgb(h: number, s: number, l: number): number[] {
  const k = (n: number) => (n + (((h % 360) + 360) % 360) / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  return [0, 8, 4].map((n) => 255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
}

/** OKLCH to sRGB (Björn Ottosson's OKLab matrices); out-of-gamut channels are clamped by the caller. */
function oklchRgb(L: number, C: number, H: number): number[] {
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((x) => 255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055));
}

// A declaration that can carry a colour: a custom property, or a property that paints text, a
// background, a border or an icon. The lookbehind starts a name only at its first character; without
// it a run of dashes backtracks quadratically.
const DECLARATION = /(?<![\w-])(?:--[\w-]+|color|background(?:-color)?|border(?:-[a-z]+)*(?:-color)?|outline-color|fill|stroke)\s*:\s*([^;{}]+)/gi;
const COLOUR = /#[0-9a-f]{3,8}(?![\w-])|(?:rgba?|hsla?|oklch)\([^()]*\)/gi;

/**
 * A page's colours as hex: the theme-color meta first, then the colours its inline styles and the
 * given stylesheets declare, most used first (ties in the order first seen). At most 12.
 */
export function cssColours(html: string, sheets: string[] = []): string[] {
  const root = parse(html);
  const meta = root.querySelectorAll('meta[name="theme-color"]').map((m) => cssHex(m.getAttribute('content') ?? ''));
  const css = [
    ...root.querySelectorAll('style').map((s) => s.text),
    ...root.querySelectorAll('[style]').map((e) => e.getAttribute('style') ?? ''),
    ...sheets,
  ].join('\n');
  const uses = new Map<string, number>();
  for (const d of css.matchAll(DECLARATION))
    for (const c of d[1]!.matchAll(COLOUR)) {
      const hex = cssHex(c[0]);
      if (hex) uses.set(hex, (uses.get(hex) ?? 0) + 1);
    }
  const ranked = [...uses].sort((x, y) => y[1] - x[1]).map(([hex]) => hex);
  return [...new Set([...meta.filter((h): h is string => h !== null), ...ranked])].slice(0, 12);
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

type Role = 'primary' | 'secondary' | 'accent' | 'text' | 'background';

/** How colourful a colour is, 0 (grey) to 1, and its hue in degrees. */
function chromaHue(hex: string): { chroma: number; hue: number } {
  const { r, g, b } = toRgb(hex);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  const hue = d === 0 ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { chroma: d / 255, hue: hue * 60 };
}
const COLOURFUL = 0.15;
const DISTINCT_HUE = 30;
const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

/**
 * A guessed role for each colour that has none, filling only the roles no colour holds yet. Colours
 * come most important first (the logo's by share, then the site's by use). Background: the first
 * light near-grey colour (or, on a dark site, the first near-black one). Text: the first near-grey
 * colour readable on it at 4.5:1. Primary: the first colourful one. Secondary, then accent: the next
 * colourful ones whose hue is clearly different from those already picked. For the owner to check.
 */
export function suggestRoles(colours: { hex: string; role: Role | null }[]): (Role | null)[] {
  const out: (Role | null)[] = colours.map(() => null);
  const held = (role: Role) => colours.find((c) => c.role === role)?.hex;
  const free = colours.map((c, i) => ({ ...c, i, ...chromaHue(c.hex), lum: luminance(c.hex) })).filter((c) => !c.role);
  const take = (role: Role, c: (typeof free)[number] | undefined) => {
    if (!c || held(role)) return held(role);
    out[c.i] = role;
    free.splice(free.indexOf(c), 1);
    return c.hex;
  };
  const grey = free.filter((c) => c.chroma < COLOURFUL);
  const background = take('background', grey.find((c) => c.lum >= 0.6) ?? grey.find((c) => c.lum <= 0.03));
  take('text', free.find((c) => c.chroma < COLOURFUL && (background ? contrast(c.hex, background) >= 4.5 : c.lum <= 0.1)));
  const picked: string[] = [];
  for (const role of ['primary', 'secondary', 'accent'] as const) {
    const hex = take(role, free.find((c) => c.chroma >= COLOURFUL && picked.every((p) => hueGap(chromaHue(p).hue, c.hue) >= DISTINCT_HUE)));
    if (hex) picked.push(hex);
  }
  return out;
}
