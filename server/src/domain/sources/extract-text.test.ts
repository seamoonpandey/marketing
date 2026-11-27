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

  describe('DOCX zip limits', () => {
    const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const patch = (fn: (v: DataView, cd: number, eocd: number) => void) => {
      const b = file('guide.docx');
      const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
      let eocd = b.length - 22;
      while (v.getUint32(eocd, true) !== 0x06054b50) eocd--;
      fn(v, v.getUint32(eocd + 16, true), eocd);
      return b;
    };
    it('refuses a central directory that declares over 100 MB', async () => {
      const b = patch((v, cd) => v.setUint32(cd + 24, 101 * 1024 * 1024, true));
      await expect(extractText(b, DOCX)).rejects.toThrow(/uncompress/i);
    });
    it('refuses more than 2,000 entries and Zip64', async () => {
      await expect(extractText(patch((v, _cd, e) => v.setUint16(e + 10, 2001, true)), DOCX)).rejects.toThrow(/entries/i);
      await expect(extractText(patch((v, _cd, e) => v.setUint16(e + 10, 0xffff, true)), DOCX)).rejects.toThrow(/Zip64/i);
    });
  });

  it('gives null text for an image', async () => {
    expect((await extractText(file('logo.png'), 'image/png')).text).toBeNull();
  });
});
