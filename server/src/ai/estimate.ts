export type AiPart =
  | { type: 'text'; text: string }
  | { type: 'file'; mediaType: string; data: Uint8Array; filename?: string };

const TOKENS_PER_PDF_PAGE = 2500;
const TOKENS_PER_IMAGE = 1600;

/**
 * Pages in a PDF, read from its bytes without parsing it.
 * shortcut: a PDF that hides its page objects in compressed object streams falls back to one page
 * per 50 KB; parse with pdf.js (async) if estimates for such files prove too far off.
 */
function pdfPages(data: Uint8Array): number {
  const raw = Buffer.from(data).toString('latin1');
  const pages = raw.match(/\/Type\s*\/Page(?![a-zA-Z])/g)?.length ?? 0;
  if (pages) return pages;
  const counts = [...raw.matchAll(/\/Count\s+(\d+)/g)].map((m) => Number(m[1]));
  return counts.length ? Math.max(...counts) : Math.max(1, Math.ceil(data.byteLength / 50_000));
}

/** Input tokens: 1 per 4 characters of text, 2,500 per PDF page, 1,600 per image, 1 per 4 bytes of any other file. */
export function estimateTokens(parts: AiPart[]): number {
  let tokens = 0;
  for (const p of parts) {
    if (p.type === 'text') tokens += Math.ceil(p.text.length / 4);
    else if (p.mediaType === 'application/pdf') tokens += pdfPages(p.data) * TOKENS_PER_PDF_PAGE;
    else if (p.mediaType.startsWith('image/')) tokens += TOKENS_PER_IMAGE;
    else tokens += Math.ceil(p.data.byteLength / 4);
  }
  return tokens;
}
