import { plainText, stripInvisible } from '../../text/normalise.ts';

// A quote matches as written: folding invisible characters, look-alike letters or other scripts' digits would let a quote that reads differently from its source pass.
/** NFKC, lower case, ASCII quote marks and dashes, whitespace collapsed. */
export const normalizeQuote = (s: string): string => plainText(s).toLowerCase();

/** True when the quote, 10 to 300 visible characters once normalised, appears in the source text. */
export function verifyQuote(sourceText: string, quote: string): boolean {
  const q = normalizeQuote(quote);
  const length = [...stripInvisible(q)].length;
  return length >= 10 && length <= 300 && normalizeQuote(sourceText).includes(q);
}
