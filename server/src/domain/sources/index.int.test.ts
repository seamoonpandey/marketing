import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDb, type TestDb } from '../../../test/helpers.ts';
import { withBrand } from '../../db/tenant.ts';
import { ValidationError } from '../../http/errors.ts';
import { ensureBucket, getObject } from '../../storage/index.ts';
import { fetchGuard } from './fetch.ts';
import { completeUpload, createUpload, getSource, listSources, savePageSource } from './index.ts';

const file = (name: string) => readFileSync(new URL(`../../../test/fixtures/base/files/${name}`, import.meta.url));
const PDF = 'application/pdf';

let t: TestDb;
let brand: string;
let server: Server;
let port: number;

beforeAll(async () => {
  await ensureBucket();
  t = await testDb();
  brand = await t.makeBrand();
  server = createServer((req, res) =>
    req.url === '/'
      ? res.writeHead(200, { 'content-type': 'text/html' }).end('<title>Home</title><p>हिमाल पश्मिना since 1998</p>')
      : res.writeHead(404).end(),
  );
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
  fetchGuard.resolve = async () => [{ address: '127.0.0.1', family: 4 }];
  fetchGuard.isBlocked = () => false;
  fetchGuard.minIntervalMs = 0;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  await t.close();
});

/** Creates an upload, PUTs the bytes to its presigned URL, and completes it. */
async function upload(filename: string, mime: string, bytes: Uint8Array) {
  const { source, uploadUrl } = await withBrand(brand, (tx) =>
    createUpload(tx, brand, { filename, mime, bytes: bytes.byteLength }),
  );
  const put = await fetch(uploadUrl, { method: 'PUT', body: bytes, headers: { 'content-type': mime } });
  expect(put.ok).toBe(true);
  return { source, complete: () => withBrand(brand, (tx) => completeUpload(tx, brand, source.id)) };
}

describe('sources', () => {
  it('stores a page snapshot under a snapshot key, with text, checksum and captured_at', async () => {
    const url = `http://shop.example:${port}/`;
    const s = await withBrand(brand, (tx) => savePageSource(tx, brand, url, 'brand_site'));
    expect(s).toMatchObject({ kind: 'page', uri: url, mime: 'text/html', trust: 'brand_site', brandId: brand });
    expect(s.objectKey).toBe(`tenant/${t.tenantId}/brand/${brand}/snapshot/${s.id}.html`);
    expect(s.text).toContain('हिमाल पश्मिना since 1998');
    expect(s.capturedAt).toBeInstanceOf(Date);
    const html = await getObject(s.objectKey);
    expect(s.checksum).toBe(createHash('sha256').update(html).digest('hex'));
    expect((await withBrand(brand, (tx) => getSource(tx, brand, s.id))).id).toBe(s.id);
  });

  it('keeps a Devanagari, spaced, long file name in meta and out of the key', async () => {
    for (const filename of ['ब्रान्ड गाइड final (2).pdf', `${'a'.repeat(296)}.pdf`]) {
      const { source, complete } = await upload(filename, PDF, file('text.pdf'));
      expect(source.objectKey).toBe(`tenant/${t.tenantId}/brand/${brand}/upload/${source.id}.pdf`);
      const done = await complete();
      expect(done.meta).toMatchObject({ filename, pages: 1, status: 'ready' });
      expect(done.text).toContain('Himal Tea House');
      expect(done.checksum).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('refuses a .pdf whose bytes are a PNG, and an executable', async () => {
    const png = await upload('logo.pdf', PDF, file('logo.png'));
    await expect(png.complete()).rejects.toBeInstanceOf(ValidationError);
    const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00]);
    const bin = await upload('setup.txt', 'text/plain', exe);
    await expect(bin.complete()).rejects.toBeInstanceOf(ValidationError);
  });

  it('reads a DOCX and gives a scanned PDF null text', async () => {
    const docx = await upload('guide.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', file('guide.docx'));
    expect((await docx.complete()).text).toContain('warm and plain');
    const scan = await upload('scan.pdf', PDF, file('scan.pdf'));
    expect((await scan.complete()).text).toBeNull();
  });

  it('refuses a type outside the list and a file over 25 MB', async () => {
    await expect(
      withBrand(brand, (tx) => createUpload(tx, brand, { filename: 'a.exe', mime: 'application/x-msdownload', bytes: 10 })),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      withBrand(brand, (tx) => createUpload(tx, brand, { filename: 'a.pdf', mime: PDF, bytes: 26 * 1024 * 1024 })),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('lists the brand’s sources', async () => {
    const list = await withBrand(brand, (tx) => listSources(tx, brand));
    expect(list.length).toBeGreaterThan(3);
    expect(list.every((s) => s.brandId === brand)).toBe(true);
  });
});
