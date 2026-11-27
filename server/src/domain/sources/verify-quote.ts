const SINGLE_QUOTES = /[‘’‚‛′‵`´]/g;
const DOUBLE_QUOTES = /[“”„‟″‶«»]/g;
const DASHES = /[‐-―−﹘﹣－]/g;

/** NFKC, lower case, ASCII quote marks and dashes, whitespace collapsed. */
export function normalizeQuote(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(DASHES, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when the quote, 10 to 300 characters once normalised, appears in the source text. */
export function verifyQuote(sourceText: string, quote: string): boolean {
  const q = normalizeQuote(quote);
  const length = [...q].length;
  return length >= 10 && length <= 300 && normalizeQuote(sourceText).includes(q);
}
