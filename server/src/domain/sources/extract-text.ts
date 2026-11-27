import mammoth from 'mammoth';
import { extractText as pdfText, getDocumentProxy } from 'unpdf';
import { ValidationError } from '../../http/errors.ts';

const MAX_PDF_PAGES = 600;
export const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const TEXT_TYPES = new Set(['text/plain', 'text/markdown', 'text/csv']);

const MAX_ZIP_UNCOMPRESSED = 100 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 2000;

/** Reads the zip's central directory and refuses a zip bomb, Zip64, or a broken zip. */
function checkZip(b: Uint8Array): void {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let e = b.length - 22;
  while (e >= 0 && e >= b.length - 22 - 0xffff && v.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0 || v.getUint32(e, true) !== 0x06054b50) throw new ValidationError('The DOCX is not a valid zip');
  const count = v.getUint16(e + 10, true);
  const dirSize = v.getUint32(e + 12, true);
  const dirAt = v.getUint32(e + 16, true);
  if (count === 0xffff || dirSize === 0xffffffff || dirAt === 0xffffffff || (e >= 20 && v.getUint32(e - 20, true) === 0x07064b50))
    throw new ValidationError('The DOCX uses Zip64, which is not accepted');
  if (count > MAX_ZIP_ENTRIES) throw new ValidationError(`The DOCX has ${count} entries; the limit is ${MAX_ZIP_ENTRIES}`);
  let total = 0;
  let p = dirAt;
  for (let i = 0; i < count; i++) {
    if (p + 46 > e || v.getUint32(p, true) !== 0x02014b50) throw new ValidationError('The DOCX is not a valid zip');
    const size = v.getUint32(p + 24, true);
    if (size === 0xffffffff) throw new ValidationError('The DOCX uses Zip64, which is not accepted');
    total += size;
    if (total > MAX_ZIP_UNCOMPRESSED) throw new ValidationError('The DOCX uncompresses to more than 100 MB');
    p += 46 + v.getUint16(p + 28, true) + v.getUint16(p + 30, true) + v.getUint16(p + 32, true);
  }
}

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
    checkZip(bytes);
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return { text: value.trim() ? value : null };
  }
  if (TEXT_TYPES.has(mime)) return { text: new TextDecoder().decode(bytes) };
  return { text: null };
}
