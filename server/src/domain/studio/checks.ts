import type { ApprovedFact } from '../../contracts/common.ts';
import type { DraftContent, DraftKind, RenderRecord } from '../../db/schema/studio.ts';
import { foldText, WORD_END, WORD_START } from '../../text/normalise.ts';
import { contrast } from '../knowledge/index.ts';
import type { BrandKit } from '../../render/index.ts';

export type Finding = {
  check: 'unverified_number' | 'prohibited_word' | 'too_long' | 'missing_cta' | 'expired_fact' | 'no_rights' | 'text_overflow' | 'not_rendered' | 'low_contrast' | 'many_hashtags';
  blocking: boolean; where: string; message: string;
};

/** Caption limits in characters by channel; email and website have none. */
const CAPTION_LIMITS: Record<string, number> = { x: 280, whatsapp: 1024, facebook: 2000, instagram: 2200, tiktok: 2200, linkedin: 3000, youtube: 5000 };

/** "1,500.50" is "1500.5"; compared as text, so no two numbers share a form (Number() makes NaN, Infinity, rounding). */
function canonical(n: string): string {
  const parts = n.replace(/[, ]/g, '').split('.');
  if (parts.length > 2) return parts.join('.'); // a date or version such as 24.10.2026, compared as written
  const int = parts[0]!.replace(/^0+(?=\d)/, '');
  const frac = (parts[1] ?? '').replace(/0+$/, '');
  return frac ? `${int}.${frac}` : int;
}

/** Number tokens: digit runs with optional , or . separators, or a space before a group of three ("18 000"). */
export function numbersIn(s: string): string[] {
  return (foldText(s).match(/\d+(?:[,.]\d+| \d{3}(?!\d))*/g) ?? []).map(canonical);
}

const flat = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v) ?? '');

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Whole-word, in the comparison form (foldText), so no invisible, look-alike or width trick can hide a word. */
export function containsWord(text: string, word: string): boolean {
  const w = foldText(word);
  return !!w && new RegExp(`${WORD_START}${escapeRe(w)}${WORD_END}`, 'u').test(foldText(text));
}

/** The prohibited words and claims of the voice and positioning facts. */
export function prohibitedOf(facts: ApprovedFact[]): string[] {
  return facts
    .filter((f) => (f.section === 'voice' && f.field === 'prohibited_words') || (f.section === 'positioning' && f.field === 'prohibited_claims'))
    .flatMap((f) => (Array.isArray(f.value) ? f.value : [f.value]))
    .filter((v): v is string => typeof v === 'string' && v.trim() !== '');
}

/** How many cards a draft must have rendered, and the text on each. */
export function cardsOf(kind: DraftKind, c: DraftContent): { headline: string; subline?: string; badge?: string }[] {
  if (kind === 'static') return c.slides.slice(0, 1);
  if (kind === 'carousel') return c.slides;
  if (kind === 'video') return c.scenes.map((s) => ({ headline: s.onScreenText }));
  return [];
}

const len = (s: string) => Array.from(s.normalize('NFC')).length;
const captionOf = (c: DraftContent['copies'][number]) => c.sentences.map((s) => s.text).join(' ');

export function checkDraft(i: {
  kind: DraftKind; channel: string; content: DraftContent; renders: RenderRecord[]; version: number; facts: ApprovedFact[];
  prohibited: string[]; assetsWithRights: Set<string>; kit: BrandKit; now?: Date;
}): Finding[] {
  void i.version; // renders are stored on the version row, so they already are this version's
  const out: Finding[] = [];
  const add = (check: Finding['check'], blocking: boolean, where: string, message: string) => out.push({ check, blocking, where, message });
  const c = i.content;
  const now = i.now ?? new Date();
  const byId = new Map(i.facts.map((f) => [f.id, f]));
  const cited = [...new Set(c.copies.flatMap((x) => x.sentences.flatMap((s) => s.factIds)))];

  // expired_fact: a cited fact that today's approved list lacks (expired, changed, retracted) or whose expiry has passed.
  for (const id of cited) {
    const f = byId.get(id);
    if (!f || (f.expiresAt && new Date(f.expiresAt) <= now)) add('expired_fact', true, `fact ${id}`, 'A fact this draft cites is not approved any more');
  }

  // Text units: [where, text]. Numbers in any of them must appear in a cited fact's value.
  const texts: [string, string][] = [];
  for (const x of c.copies) {
    texts.push([`caption ${x.language}`, captionOf(x)], [`cta ${x.language}`, x.cta], [`hashtags ${x.language}`, x.hashtags.join(' ')]);
  }
  c.slides.forEach((s, n) => texts.push([`slide ${n + 1}`, [s.headline, s.subline, s.badge].filter(Boolean).join(' ')]));
  c.scenes.forEach((s, n) => texts.push([`scene ${n + 1}`, `${s.onScreenText} ${s.voiceover}`]));

  const allowed = new Set(cited.flatMap((id) => numbersIn(flat(byId.get(id)?.value))));
  for (const [where, text] of texts)
    for (const n of new Set(numbersIn(text)))
      if (!allowed.has(n)) add('unverified_number', true, where, `${n} is not in any approved fact this draft cites`);

  // A hashtag runs words together ("PashminaGuaranteed"), so there the word is looked for anywhere in it.
  const runTogether = (s: string) => foldText(s).replace(/[\s_]+/g, '');
  const inTags = (tags: string, w: string) => !!runTogether(w) && tags.split(' ').some((t) => runTogether(t).includes(runTogether(w)));
  for (const [where, text] of texts)
    for (const w of i.prohibited)
      if (where.startsWith('hashtags') ? inTags(text, w) : containsWord(text, w)) add('prohibited_word', true, where, `Uses "${w}", which the brand prohibits`);

  const limit = CAPTION_LIMITS[i.channel];
  for (const x of c.copies) {
    const n = len(captionOf(x));
    if (limit !== undefined && n > limit) add('too_long', true, `caption ${x.language}`, `${n} characters; ${i.channel} allows ${limit}`);
    if (!x.cta.trim()) add('missing_cta', true, `cta ${x.language}`, 'No call to action');
    if (x.hashtags.length > 10) add('many_hashtags', false, `hashtags ${x.language}`, `${x.hashtags.length} hashtags; 10 or fewer read better`);
  }
  if (!c.copies.length) add('missing_cta', true, 'copy', 'No call to action');

  c.slides.forEach((s, n) => {
    if (s.photoAssetId && !i.assetsWithRights.has(s.photoAssetId)) add('no_rights', true, `slide ${n + 1}`, 'The photo has no licence recorded, or its licence has expired');
  });
  for (const id of new Set(i.renders.flatMap((r) => (r.logoAssetId ? [r.logoAssetId] : []))))
    if (!i.assetsWithRights.has(id)) add('no_rights', true, 'renders', 'The logo in the renders has no licence recorded, or its licence has expired');

  for (const r of i.renders)
    if (r.overflow) add('text_overflow', true, `${r.type === 'video' ? 'video' : `card ${r.index + 1}`} ${r.ratio}`, 'The text does not fit its template at this size');

  if (i.kind !== 'post') {
    const cards = cardsOf(i.kind, c);
    if (!cards.length) add('not_rendered', true, 'cards', 'There is no slide or scene text to render');
    else {
      const have = new Set(i.renders.filter((r) => r.type === 'image').map((r) => `${r.index}|${r.ratio}`));
      const missing = cards.some((_, n) => c.ratios.some((r) => !have.has(`${n}|${r}`)));
      if (missing || !c.ratios.length) add('not_rendered', true, 'renders', 'This version has not been rendered');
      else if (i.kind === 'video' && !i.renders.some((r) => r.type === 'video')) add('not_rendered', true, 'video', 'The video has not been rendered');
    }
  }

  const ratio = contrast(i.kit.colours.text, i.kit.colours.background);
  if (ratio < 4.5) add('low_contrast', false, 'palette', `Text on background has a contrast of ${ratio.toFixed(1)}; 4.5 is the minimum`);

  return out.sort((a, b) => Number(b.blocking) - Number(a.blocking));
}
