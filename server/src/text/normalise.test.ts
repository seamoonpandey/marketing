import { describe, expect, it } from 'vitest';
import { asciiDigits, cleanCut, foldText, latinLookalikes, plainText, stripAccents, stripInvisible } from './normalise.ts';

// Every trick an earlier review proved against one module's own copy (approve/rules, studio/checks, studio/drafts,
// plan/balance, sources/verify-quote), and a few of the same kinds none had tried. [what, input, foldText(input)].
const FOLDS: [string, string, string][] = [
  ['upper case', 'GUARANTEED', 'guaranteed'],
  ['full-width letters', 'ＧＵＡＲＡＮＴＥＥＤ', 'guaranteed'],
  ['full-width digits', 'NPR ４０', 'npr 40'],
  ['zero-width space', 'guaran​teed', 'guaranteed'],
  ['soft hyphen', 'gu­aranteed', 'guaranteed'],
  ['left-to-right mark', 'guar‎antee', 'guarantee'],
  ['invisible separator', 'guar⁣antee', 'guarantee'],
  ['combining grapheme joiner', 'guar͏antee', 'guarantee'],
  ['variation selector', 'guar️anteed', 'guaranteed'],
  ['Hangul filler', 'riskㅤfree', 'riskfree'],
  ['word joiner', 'guar⁠antee', 'guarantee'],
  ['byte order mark', 'guar﻿antee', 'guarantee'],
  ['tag character', 'guar\u{e0041}antee', 'guarantee'],
  ['right-to-left override and isolate', '‮guarantee‬⁦', 'guarantee'],
  ['NUL', 'pash\u0000mina', 'pashmina'],
  ['bell and escape', 'Warm\u0007 shawl\u001b', 'warm shawl'],
  ['DEL and a C1 control', 'guar\u007fan\u009btee', 'guarantee'],
  ['combining acute', 'guarantée', 'guarantee'],
  ['combining grave', 'gùarantee', 'guarantee'],
  ['keycap', '9️⃣0️⃣%', '90%'],
  ['precomposed accent', 'Café', 'cafe'],
  ['Cyrillic a', 'Results guаranteed', 'results guaranteed'],
  ['Cyrillic C', 'Сure', 'cure'],
  ['Cyrillic i and e', 'rіsk thе', 'risk the'],
  ['Cyrillic P', 'Рharmacy', 'pharmacy'],
  ['Greek capital alpha', 'GUΑRANTEED', 'guaranteed'],
  ['Turkish dotless and dotted i', 'rısk İt', 'risk it'],
  ['non-breaking hyphen', 'risk‑free', 'risk-free'],
  ['en dash with spaces', 'RISK – FREE', 'risk - free'],
  ['minus sign and full-width hyphen', '7−14－21', '7-14-21'],
  ['curly quotes', '“hand-rolled” Nepal’s', '"hand-rolled" nepal\'s'],
  ['newline and runs of spaces', ' better\n  than ', 'better than'],
  ['narrow no-break space', '18 000', '18 000'],
  ['tab', 'NPR\t18', 'npr 18'],
  ['Devanagari digits', '१५% छुट', '15% छुट'],
  ['Devanagari digits with separators', 'NPR १,५००.५०', 'npr 1,500.50'],
  ['Arabic-Indic digits', '٤٥٠٠', '4500'],
  ['adjacent digit sets', String.fromCodePoint(0x116da, 0x116db), '01'],
];

// What the folds must not merge: each pair stays apart.
const APART: [string, string, string][] = [
  ['Devanagari vowel signs', 'सस्ता', 'सस्तो'],
  ['different Nepali words', 'दशैं छुट', 'तिहार छुट'],
  ['a decimal point', '5.0', '50'],
  ['a different Latin word', 'cured', 'cure'],
];

describe('foldText', () => {
  it.each(FOLDS)('folds %s', (_, input, out) => expect(foldText(input)).toBe(out));
  it.each(APART)('keeps %s apart', (_, a, b) => expect(foldText(a)).not.toBe(foldText(b)));
  it('reads composed and decomposed Devanagari alike', () => expect(foldText('क़लम')).toBe(foldText('क़लम')));
});

describe('the parts', () => {
  it('stripInvisible removes only what draws nothing; whitespace, letters and joiner-free Devanagari stay', () => {
    expect(stripInvisible('a​­\u0000\u0085‮️b')).toBe('ab');
    expect(stripInvisible('a\tb\nc\r d')).toBe('a\tb\nc\r d');
    expect(stripInvisible('हिमाल क़लम')).toBe('हिमाल क़लम');
  });
  it('stripAccents drops generic accents and keeps Devanagari marks', () => {
    expect(stripAccents('résumé⃣')).toBe('resume');
    expect(stripAccents('दशैं')).toBe('दशैं');
  });
  it('asciiDigits maps every decimal digit and leaves the rest', () => {
    expect(asciiDigits('रु ४,५०० / ٤٥ / ４５')).toBe('रु 4,500 / 45 / 45');
  });
  it('latinLookalikes keeps case and other letters', () => {
    expect(latinLookalikes('Сure Рrice ΑΒ नेपाल')).toBe('Cure Price AB नेपाल');
  });
  it('plainText keeps case, digits and invisible characters', () => {
    expect(plainText('  “Rs” —​ १५  ')).toBe('"Rs" -​ १५');
  });
});

describe('cleanCut', () => {
  it('removes a NUL and bidi controls, keeps line breaks, trims', () => expect(cleanCut(' pash\u0000mina\u202e\nshawl ', 50)).toBe('pashmina\nshawl'));
  it('leaves an emoji split at the cut well-formed', () => {
    const out = cleanCut('ab😀', 3);
    expect(out.isWellFormed()).toBe(true);
    expect(out.startsWith('ab')).toBe(true);
  });
});
