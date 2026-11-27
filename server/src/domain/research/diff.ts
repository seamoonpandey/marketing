import { diffArrays } from 'diff';

type Block = { before: string; after: string };

const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
// Dates, clocks and "N people viewing"-style counters are masked, so a block that differs only by them is noise.
const NOISE = [
  /\b\d{4}-\d{2}-\d{2}\b/g,
  /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/g,
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}\\s+\\d{4}\\b`, 'gi'),
  new RegExp(`\\b${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}\\b`, 'gi'),
  /\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?/gi,
  /©\s*\d{4}/g,
  /\b\d[\d,]*\s+(?:people|persons|viewing|viewers|visitors|views|watching|sold|left|bought|online|shoppers|customers|users)\b/gi,
];
const mask = (s: string) => NOISE.reduce((t, re) => t.replace(re, '#'), s);
const COOKIE = /\bcookies?\b/i;

const blocks = (text: string) =>
  text.split(/\n+/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);

function isNoise({ before, after }: Block): boolean {
  if (before.length < 20 && after.length < 20) return true;
  if (COOKIE.test(before + after) && (!before || !after || (COOKIE.test(before) && COOKIE.test(after)))) return true;
  return before !== '' && after !== '' && mask(before) === mask(after);
}

/**
 * Compares paragraph blocks (whitespace collapsed). A changed block pairs its old and new side;
 * an added or removed block has an empty other side. Date, time, counter, cookie-notice and
 * under-20-character changes are ignored, so `changed` is false for them and no model is called.
 */
export function diffText(before: string, after: string): { changed: boolean; blocks: Block[] } {
  const out: Block[] = [];
  const parts = diffArrays(blocks(before), blocks(after));
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    if (!p.added && !p.removed) continue;
    const next = parts[i + 1];
    const removed = p.removed ? p.value : [];
    const added = p.added ? p.value : p.removed && next?.added ? (i++, next.value) : [];
    for (let k = 0; k < Math.max(removed.length, added.length); k++)
      out.push({ before: removed[k] ?? '', after: added[k] ?? '' });
  }
  const real = out.filter((b) => !isNoise(b));
  return { changed: real.length > 0, blocks: real };
}
