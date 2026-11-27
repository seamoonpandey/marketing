// Risk by fixed rules (design section 3, spec §21.2). False positives only raise the risk, so the
// rules lean wide: every string in the content is read, and industries match whole words.
import type { ApprovalRisk } from '../../db/schema/approve.ts';
import { asciiDigits, latinLookalikes, plainText, stripAccents, stripInvisible, WORD_END as END, WORD_START as START } from '../../text/normalise.ts';

// Case and digits are kept as written, so a reason quotes the copy ("१५%"); the rules read every script's digits themselves.
/** Invisible characters and generic accents removed, then plainText: NFKC, ASCII dashes and quote marks, runs of white space as one space, trimmed. */
export const plain = (s: string): string => plainText(stripAccents(stripInvisible(s)));

/** Every string in a draft's content, one per line. */
export function textOf(v: unknown): string {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(textOf).join('\n');
  if (v && typeof v === 'object') return Object.values(v).map(textOf).join('\n');
  return '';
}

const NUM = '\\p{Nd}[\\p{Nd},.]*'; // \p{Nd} is every script's digits, Devanagari ones included
const re = (src: string) => new RegExp(src, 'iu');

const REGULATED = re(`${START}(?:${'health|healthcare|medical|medicine|pharmacy|pharmaceutical|clinic|hospital|finance|financial|banking|bank|insurance|investment|legal|law|safety|employment|recruitment|political|politics|children|childcare|alcohol|tobacco|gambling|betting'})${END}`);
const RULES: { risk: ApprovalRisk; re: RegExp; label: string }[] = [
  { risk: 'high', re: re(`${START}(?:guarantee[sd]?|cures?|risk(?: ?- ?| )?free)${END}`), label: 'Promise' },
  { risk: 'medium', re: re(`${START}(?:n?rs|npr|रु|रू)\\.? ?${NUM}`), label: 'Price' },
  { risk: 'medium', re: re(`${NUM} ?(?:%|percent${END}|per cent${END}|प्रतिशत)`), label: 'Percentage' },
  { risk: 'medium', re: re(`(?:${START}(?:best|cheapest|lowest|better than)${END}|#1(?!\\p{N})|${START}no\\.? ?1(?!\\p{N}))`), label: 'Comparison' },
];

export function riskOf(i: { text: string; pillar: string | null; industry: string | null }): { risk: ApprovalRisk; reasons: string[] } {
  const high: string[] = [];
  const medium: string[] = [];
  const industry = i.industry && latinLookalikes(plain(i.industry));
  if (industry && REGULATED.test(industry)) high.push(`Regulated industry "${industry}"`);
  const text = latinLookalikes(plain(i.text));
  for (const r of RULES) {
    // "#१" is "#1": a rule that names a digit (No. 1) is tried again with every script's digits as ASCII.
    const m = r.re.exec(text) ?? r.re.exec(asciiDigits(text));
    if (m) (r.risk === 'high' ? high : medium).push(`${r.label} "${m[0]}"`);
  }
  if (i.pillar === 'comparison' || i.pillar === 'offer') medium.push(`Pillar "${i.pillar}"`);
  return { risk: high.length ? 'high' : medium.length ? 'medium' : 'low', reasons: [...high, ...medium] };
}
