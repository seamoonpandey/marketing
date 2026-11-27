import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractText } from './extract-text.ts';

const file = (name: string) => new Uint8Array(readFileSync(new URL(`../../../test/fixtures/base/files/${name}`, import.meta.url)));

describe('extractText', () => {
  it('reads a PDF text layer and counts its pages', async () => {
    const r = await extractText(file('text.pdf'), 'application/pdf');
    expect(r.text).toContain('Himal Tea House sells hand-rolled green tea since 1998.');
    expect(r.pages).toBe(1);
  });

  it('gives null text for a PDF with no text layer', async () => {
    expect(await extractText(file('scan.pdf'), 'application/pdf')).toEqual({ text: null, pages: 1 });
  });

  it('reads a DOCX', async () => {
    const r = await extractText(file('guide.docx'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(r.text).toContain('Brand guide: our tone is warm and plain.');
    expect(r.text).toContain('हिमाल पश्मिना');
  });

  it('gives null text for an image', async () => {
    expect((await extractText(file('logo.png'), 'image/png')).text).toBeNull();
  });
});
