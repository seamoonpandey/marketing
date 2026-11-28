import { randomUUID } from 'node:crypto';
import { extract } from '../../../ai/index.ts';
import { withBrand } from '../../../db/tenant.ts';
import { ValidationError } from '../../../http/errors.ts';
import { cleanCut, foldText, plainText } from '../../../text/normalise.ts';
import { getBrand } from '../../brands/index.ts';
import { approvedFacts } from '../../knowledge/index.ts';
import { KEYWORD_MAX_OUTPUT, KEYWORD_SYSTEM, KeywordAnswer, keywordParts } from './prompts.ts';

export const MAX_KEYWORDS = 15;
const MAX_KEYWORD_CHARS = 80;
const MAX_SUGGESTIONS = 10;

/** Cleaned (unsafe characters out, plain spacing), empties dropped, deduped by folded text, in the given order. */
function tidy(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    const k = plainText(cleanCut(r, Infinity));
    const f = foldText(k);
    if (!f || seen.has(f)) continue;
    seen.add(f);
    out.push(k);
  }
  return out;
}

/** The owner's keywords cleaned: ValidationError when none are left, more than 15, or one over 80 characters. */
export function cleanKeywords(raw: string[]): string[] {
  const k = tidy(raw);
  if (!k.length) throw new ValidationError('Add at least one keyword');
  if (k.length > MAX_KEYWORDS) throw new ValidationError(`Use at most ${MAX_KEYWORDS} keywords`);
  if (k.some((x) => x.length > MAX_KEYWORD_CHARS)) throw new ValidationError(`Keep each keyword to ${MAX_KEYWORD_CHARS} characters`);
  return k;
}

/** 6 to 10 search keywords from the brand's approved facts; ValidationError with no approved facts, before any model call. */
export async function suggestKeywords(brandId: string): Promise<string[]> {
  const { facts, country } = await withBrand(brandId, async (tx) => ({
    facts: await approvedFacts(tx, brandId), country: (await getBrand(tx, brandId)).country,
  }));
  if (!facts.length) throw new ValidationError('Approve some brand facts first: keywords come from what the brand sells and where');
  const { object } = await extract({
    brandId, runType: 'research_discovery_keywords', runId: randomUUID(), system: KEYWORD_SYSTEM,
    parts: keywordParts(country, facts), schema: KeywordAnswer, maxOutputTokens: KEYWORD_MAX_OUTPUT,
  });
  return tidy(object.keywords).filter((k) => k.length <= MAX_KEYWORD_CHARS).slice(0, MAX_SUGGESTIONS);
}
