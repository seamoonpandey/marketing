import { DOCX } from './extract-text.ts';

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Allowed upload types and the extension their object key gets. */
export const UPLOAD_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  [DOCX]: 'docx',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/csv': 'csv',
};

const TEXT_TYPES = new Set(['text/plain', 'text/markdown', 'text/csv']);
const SVG = /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!doctype svg[^>]*>\s*)?<svg[\s>]/i;

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** The type the bytes really are, by magic bytes; 'text' for valid UTF-8 without NUL; null otherwise. */
export function sniff(b: Uint8Array): string | null {
  if (startsWith(b, ascii('%PDF-'))) return 'application/pdf';
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(b, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(b, ascii('RIFF')) && startsWith(b, ascii('WEBP'), 8)) return 'image/webp';
  if (startsWith(b, [0x50, 0x4b, 0x03, 0x04])) {
    // A DOCX is a zip whose entry names are stored in plain bytes.
    return Buffer.from(b).includes('word/document.xml') ? DOCX : null;
  }
  if (b.includes(0)) return null;
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(b);
  } catch {
    return null;
  }
  return SVG.test(text) ? 'image/svg+xml' : 'text';
}

/** True when the bytes are the declared type. TXT, MD and CSV share one byte signature: valid UTF-8 text. */
export function bytesMatch(declared: string, bytes: Uint8Array): boolean {
  const actual = sniff(bytes);
  if (TEXT_TYPES.has(declared)) return actual === 'text' || actual === 'image/svg+xml';
  return actual === declared;
}
