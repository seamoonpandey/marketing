import mammoth from 'mammoth';
import { extractText as pdfText, getDocumentProxy } from 'unpdf';
import { ValidationError } from '../../http/errors.ts';

export const MAX_PDF_PAGES = 600;
export const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const TEXT_TYPES = new Set(['text/plain', 'text/markdown', 'text/csv']);

/**
 * The text of an uploaded file, for the quote check: a PDF's text layer (null when it has none),
 * a DOCX's raw text, or a text file. Images and SVGs give null. PDFs also report their page count.
 */
export async function extractText(bytes: Uint8Array, mime: string): Promise<{ text: string | null; pages?: number }> {
  if (mime === 'application/pdf') {
    const pdf = await getDocumentProxy(new Uint8Array(bytes)); // pdf.js takes ownership of the buffer
    const pages = pdf.numPages;
    if (pages > MAX_PDF_PAGES) throw new ValidationError(`The PDF has ${pages} pages; the limit is ${MAX_PDF_PAGES}`);
    const { text } = await pdfText(pdf, { mergePages: true });
    return { text: text.trim() ? text : null, pages };
  }
  if (mime === DOCX) {
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return { text: value.trim() ? value : null };
  }
  if (TEXT_TYPES.has(mime)) return { text: new TextDecoder().decode(bytes) };
  return { text: null };
}
