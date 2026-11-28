// What a homepage's markup and CSS say about the brand's look: where its logo is, which stylesheets
// it loads and which fonts it uses. Pure functions over text the fetcher already holds.
import { parse, type HTMLElement } from 'node-html-parser';
import { foldText } from '../../../text/normalise.ts';

const MAX_LOGOS = 3;
const MAX_SHEETS = 4;
const MAX_FONTS = 4;

/** href resolved against the page; only http(s). */
function absolute(href: string | undefined, base: string): string | null {
  if (!href?.trim()) return null;
  try {
    const u = new URL(href.trim(), base);
    return /^https?:$/.test(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

const unique = (urls: (string | null)[], max: number) => [...new Set(urls.filter((u): u is string => !!u))].slice(0, max);

/** The stylesheets the page links, in page order, at most 4. */
export function stylesheetLinks(html: string, base: string): string[] {
  const links = parse(html).querySelectorAll('link[href]').filter((l) => /(^|\s)stylesheet(\s|$)/i.test(l.getAttribute('rel') ?? ''));
  return unique(links.map((l) => absolute(l.getAttribute('href'), base)), MAX_SHEETS);
}

/** Every `logo` an Organization-like JSON-LD block names, as URLs. */
function jsonLdLogos(root: HTMLElement): (string | undefined)[] {
  const found: (string | undefined)[] = [];
  const walk = (v: unknown, depth: number): void => {
    if (depth > 6 || !v || typeof v !== 'object') return;
    if (Array.isArray(v)) return v.forEach((x) => walk(x, depth + 1));
    const o = v as Record<string, unknown>;
    const logo = o.logo;
    for (const l of Array.isArray(logo) ? logo : [logo]) {
      const url = l && typeof l === 'object' ? ((l as Record<string, unknown>).url ?? (l as Record<string, unknown>).contentUrl) : l;
      if (typeof url === 'string') found.push(url);
    }
    for (const x of Object.values(o)) if (x && typeof x === 'object') walk(x, depth + 1);
  };
  for (const s of root.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      walk(JSON.parse(s.text), 0);
    } catch {
      // A broken block says nothing.
    }
  }
  return found;
}

const marked = (e: HTMLElement | null) =>
  !!e && /logo/i.test(`${e.getAttribute('class') ?? ''} ${e.getAttribute('id') ?? ''} ${e.getAttribute('alt') ?? ''} ${e.getAttribute('src') ?? ''}`);
const inHeader = (e: HTMLElement) => {
  for (let p = e.parentNode; p; p = p.parentNode) if (['HEADER', 'NAV'].includes(p.tagName)) return true;
  return false;
};

/**
 * Where the brand's logo most likely is, best first, at most 3: the JSON-LD logo, then an image marked
 * "logo" (in its class, id, alt or file name, or its parent's) with those in the header or nav first,
 * then the touch icon and an SVG or PNG icon. Inline SVG and og:image are left out: one has no file
 * and often no colours of its own, the other is usually a banner photo.
 */
export function logoCandidates(html: string, base: string): string[] {
  const root = parse(html);
  const imgs = root.querySelectorAll('img').filter((i) => marked(i) || marked(i.parentNode));
  const src = (i: HTMLElement) => absolute(i.getAttribute('src') ?? i.getAttribute('data-src'), base);
  const icons = root.querySelectorAll('link[href]').filter((l) => /icon/i.test(l.getAttribute('rel') ?? ''));
  const touch = icons.filter((l) => /apple-touch-icon/i.test(l.getAttribute('rel') ?? ''));
  const size = (l: HTMLElement) => parseInt(l.getAttribute('sizes') ?? '0', 10) || 0;
  const plain = icons
    .filter((l) => !touch.includes(l) && !/\.ico(\?|$)/i.test(l.getAttribute('href') ?? '') && l.getAttribute('type') !== 'image/x-icon')
    .sort((a, b) => Number(/svg/i.test(b.getAttribute('href') ?? '')) - Number(/svg/i.test(a.getAttribute('href') ?? '')) || size(b) - size(a));
  return unique(
    [
      ...jsonLdLogos(root).map((u) => absolute(u, base)),
      ...imgs.filter(inHeader).map(src),
      ...imgs.filter((i) => !inHeader(i)).map(src),
      ...[...touch, ...plain].map((l) => absolute(l.getAttribute('href'), base)),
    ],
    MAX_LOGOS,
  );
}

// Generic, system, emoji and icon fonts say nothing about the brand.
const NOT_A_BRAND_FONT =
  /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|math|emoji|fangsong|ui-[\w-]+|-apple-system|blinkmacsystemfont|segoe ui( \w+)?|helvetica( neue)?|arial|sans|inherit|initial|unset|revert|.*(emoji|icon|awesome|glyph).*|dashicons|eicons|swiper-icons|slick)$/i;

/** A family name as written: unquoted, Next.js's generated `__Inter_d65c78` back to Inter, fallbacks and variables dropped. */
function family(raw: string): string | null {
  let name = raw.trim().replace(/^['"]|['"]$/g, '').trim();
  if (!name || name.includes('var(') || /fallback/i.test(name)) return null;
  name = name.replace(/^__(.+?)_[0-9a-f]{6}$/i, '$1').replaceAll('_', ' ');
  return name.length > 60 || NOT_A_BRAND_FONT.test(name) ? null : name;
}

/**
 * The fonts the page uses, at most 4: Google Fonts families it loads first (in page order), then the
 * first family of each font-family declaration in its inline styles and the given stylesheets, most
 * declared first. Generic, system and icon fonts are dropped.
 */
export function fontFamilies(html: string, sheets: string[] = []): string[] {
  const root = parse(html);
  const google = root
    .querySelectorAll('link[href]')
    .map((l) => absolute(l.getAttribute('href'), 'https://page.invalid/'))
    .filter((u): u is string => !!u && new URL(u).hostname === 'fonts.googleapis.com')
    .flatMap((u) => new URL(u).searchParams.getAll('family').flatMap((f) => f.split('|')))
    .map((f) => f.split(':')[0]!);
  const css = [...root.querySelectorAll('style').map((s) => s.text), ...root.querySelectorAll('[style]').map((e) => e.getAttribute('style') ?? ''), ...sheets].join('\n');
  const uses = new Map<string, number>();
  for (const m of css.matchAll(/(?<![\w-])font-family\s*:\s*([^;{}]+)/gi)) {
    const name = family(m[1]!.split(',')[0]!);
    if (name) uses.set(name, (uses.get(name) ?? 0) + 1);
  }
  const declared = [...uses].sort((a, b) => b[1] - a[1]).map(([n]) => n);
  const seen = new Set<string>();
  return [...google.map(family), ...declared]
    .filter((n): n is string => !!n && !seen.has(foldText(n)) && !!seen.add(foldText(n)))
    .slice(0, MAX_FONTS);
}
