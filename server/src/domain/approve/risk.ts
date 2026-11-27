// Risk by fixed rules (design section 3, spec §21.2). False positives only raise the risk, so the
// rules lean wide: every string in the content is read, and industries match whole words.
import type { ApprovalRisk } from '../../db/schema/approve.ts';

const DASHES = /[‐-―−﹘﹣－]/gu;

/** NFKC, invisible characters (format and every other default-ignorable one) removed, dashes made ASCII, runs of white space made one space, trimmed. */
export const plain = (s: string): string => s.normalize('NFKC').replace(/[\p{Cf}\p{Default_Ignorable_Code_Point}]/gu, '').replace(DASHES, '-').replace(/\s+/gu, ' ').trim();

/** Every string in a draft's content, one per line. */
export function textOf(v: unknown): string {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(textOf).join('\n');
  if (v && typeof v === 'object') return Object.values(v).map(textOf).join('\n');
  return '';
}

// Not preceded / not followed by a letter, combining mark (Devanagari vowel signs), digit or underscore.
const START = '(?<![\\p{L}\\p{M}\\p{N}_])';
const END = '(?![\\p{L}\\p{M}\\p{N}_])';
const NUM = '\\p{Nd}[\\p{Nd},.]*'; // \p{Nd} is every script's digits, Devanagari ones included
const re = (src: string) => new RegExp(src, 'iu');

const REGULATED = re(`${START}(?:${'health|healthcare|medical|medicine|pharmacy|pharmaceutical|clinic|hospital|finance|financial|banking|bank|insurance|investment|legal|law|safety|employment|recruitment|political|politics|children|childcare|alcohol|tobacco|gambling|betting'})${END}`);
const RULES: { risk: ApprovalRisk; re: RegExp; label: string }[] = [
  { risk: 'high', re: re(`${START}(?:guarantee[sd]?|cures?|risk(?: ?- ?| )?free)${END}`), label: 'Promise' },
  { risk: 'medium', re: re(`${START}(?:n?rs|npr|रु|रू)\\.? ?${NUM}`), label: 'Price' },
  { risk: 'medium', re: re(`${NUM} ?(?:%|percent${END}|per cent${END}|प्रतिशत)`), label: 'Percentage' },
  { risk: 'medium', re: re(`(?:${START}(?:best|cheapest|lowest|better than)${END}|#1(?!\\p{N})|${START}no\\.? ?1(?!\\p{N}))`), label: 'Comparison' },
];

// Cyrillic and Greek letters that look like Latin ones (and Turkish dotless and dotted i), read as those Latin letters.
const LOOKALIKE = 'АВЕКМНОРСТУХІЈЅӀаеорсухіјѕԁһԛԝӏΑΒΕΖΗΙΚΜΝΟΡΤΥΧαιονρυκıİ';
const LATIN = 'ABEKMHOPCTYXIJSIaeopcyxijsdhqwlABEZHIKMNOPTYXaiovpukiI';
const latin = (s: string) => s.replace(new RegExp(`[${LOOKALIKE}]`, 'gu'), (c) => LATIN[LOOKALIKE.indexOf(c)]!);

export function riskOf(i: { text: string; pillar: string | null; industry: string | null }): { risk: ApprovalRisk; reasons: string[] } {
  const high: string[] = [];
  const medium: string[] = [];
  const industry = i.industry && latin(plain(i.industry));
  if (industry && REGULATED.test(industry)) high.push(`Regulated industry "${industry}"`);
  const text = latin(plain(i.text));
  for (const r of RULES) {
    const m = r.re.exec(text);
    if (m) (r.risk === 'high' ? high : medium).push(`${r.label} "${m[0]}"`);
  }
  if (i.pillar === 'comparison' || i.pillar === 'offer') medium.push(`Pillar "${i.pillar}"`);
  return { risk: high.length ? 'high' : medium.length ? 'medium' : 'low', reasons: [...high, ...medium] };
}
