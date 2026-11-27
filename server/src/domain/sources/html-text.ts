import { parse } from 'node-html-parser';

const DROPPED = 'script, style, nav, noscript, template, svg, iframe';

/** The readable text of a page: no script, style or nav; one line per block; whitespace collapsed. */
export function htmlText(html: string): string {
  const root = parse(html);
  for (const el of root.querySelectorAll(DROPPED)) el.remove();
  const body = root.querySelector('body') ?? root;
  return body.structuredText
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

export function htmlTitle(html: string): string {
  return parse(html).querySelector('title')?.text.replace(/\s+/g, ' ').trim() ?? '';
}
