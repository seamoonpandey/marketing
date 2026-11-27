// The text folds every check uses before it compares or searches text, in one place, so that a trick closed
// for one check is closed for all. Pure functions; each module keeps its own rule on top.

// Draws nothing: default-ignorable code points (zero-width spaces and joiners, soft hyphen, word joiner, variation
// selectors, bidi marks and controls, the combining grapheme joiner, Hangul fillers, tag characters), the other format
// characters, and control characters other than whitespace (NUL, DEL and the C1 set included).
const INVISIBLE = /[\p{Default_Ignorable_Code_Point}\p{Cf}\u0000-\u0008\u000e-\u001f\u007f-\u009f]/gu;

/** Removes every character that draws nothing, so it cannot split a word or a number. */
export const stripInvisible = (s: string): string => s.replace(INVISIBLE, '');

// Generic combining accents and enclosing marks (a keycap). Each script's own marks, such as Devanagari vowel signs,
// are not in these blocks and stay, since they tell words apart.
const ACCENTS = /[̀-ͯ᪰-᫿᷀-᷿⃐-⃿︠-︯]/g;

/** Compatibility forms folded (full-width letters, ligatures) and generic accents removed: NFKD, the accents dropped, NFC. */
export const stripAccents = (s: string): string => s.normalize('NFKD').replace(ACCENTS, '').normalize('NFC');

/** ASCII digits for every Unicode decimal digit (Devanagari, Arabic-Indic, full-width …). */
export function asciiDigits(s: string): string {
  return s.replace(/\p{Nd}/gu, (c) => {
    let cp = c.codePointAt(0)!;
    const at = cp;
    // Digit sets are runs of ten in order, some of them adjacent, so the offset from the run's start mod 10 is the digit.
    while (cp > 0 && /\p{Nd}/u.test(String.fromCodePoint(cp - 1))) cp--;
    return String((at - cp) % 10);
  });
}

// Cyrillic and Greek letters that look like Latin ones (and Turkish dotless and dotted i), read as those Latin letters.
const LOOKALIKE = 'АВЕКМНОРСТУХІЈЅӀаеорсухіјѕԁһԛԝӏΑΒΕΖΗΙΚΜΝΟΡΤΥΧαιονρυκıİ';
const LATIN = 'ABEKMHOPCTYXIJSIaeopcyxijsdhqwlABEZHIKMNOPTYXaiovpukiI';
const LOOKALIKES = new RegExp(`[${LOOKALIKE}]`, 'gu');

/** Look-alike Cyrillic and Greek letters as the Latin letters they imitate; case is kept. */
export const latinLookalikes = (s: string): string => s.replace(LOOKALIKES, (c) => LATIN[LOOKALIKE.indexOf(c)]!);

const SINGLE_QUOTES = /[‘’‚‛′‵`´]/g;
const DOUBLE_QUOTES = /[“”„‟″‶«»]/g;
const DASHES = /[‐-―−﹘﹣－]/g;

/** NFKC, curly quote marks and dashes as ASCII, runs of whitespace as one space, trimmed. Case is kept. */
export const plainText = (s: string): string =>
  s.normalize('NFKC').replace(SINGLE_QUOTES, "'").replace(DOUBLE_QUOTES, '"').replace(DASHES, '-').replace(/\s+/g, ' ').trim();

/**
 * The comparison form for a check that looks for a word or number someone may disguise: invisible characters and
 * generic accents removed, digits of every script as ASCII, look-alike letters as Latin, plainText, lower case.
 */
export const foldText = (s: string): string => plainText(latinLookalikes(asciiDigits(stripAccents(stripInvisible(s))))).toLowerCase();

/** Regex sources for a whole-word match: not preceded or followed by a letter, combining mark (Devanagari vowel signs), digit or underscore. */
export const WORD_START = '(?<![\\p{L}\\p{M}\\p{N}_])';
export const WORD_END = '(?![\\p{L}\\p{M}\\p{N}_])';
