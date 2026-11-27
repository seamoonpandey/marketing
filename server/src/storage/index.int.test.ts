import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureBucket, getObject, objectKey, presignDownload, presignUpload, putObject } from './index.ts';

beforeAll(() => ensureBucket());

const key = (ext: string) => objectKey(randomUUID(), randomUUID(), 'upload', randomUUID(), ext);

describe('storage', () => {
  it('builds keys from IDs only', () => {
    expect(objectKey('t1', 'b1', 'upload', 'id1', 'pdf')).toBe('tenant/t1/brand/b1/upload/id1.pdf');
  });

  it('reads back the bytes it stored', async () => {
    const k = key('bin');
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    await putObject(k, bytes, 'application/octet-stream');
    expect(await getObject(k)).toEqual(bytes);
  });

  it('uploads through a presigned URL', async () => {
    const k = key('txt');
    const url = await presignUpload(k, 'text/plain', 1024);
    const res = await fetch(url, { method: 'PUT', body: 'hello', headers: { 'content-type': 'text/plain' } });
    expect(res.ok).toBe(true);
    expect(new TextDecoder().decode(await getObject(k))).toBe('hello');
  });

  it('serves anything but a raster image as an attachment', async () => {
    for (const [ext, type, attachment] of [
      ['pdf', 'application/pdf', true],
      ['svg', 'image/svg+xml', true],
      ['png', 'image/png', false],
    ] as const) {
      const k = key(ext);
      await putObject(k, new Uint8Array([1, 2, 3]), type);
      const res = await fetch(await presignDownload(k));
      expect(res.status).toBe(200);
      expect(res.headers.get('content-disposition')?.startsWith('attachment') ?? false).toBe(attachment);
    }
  });
});
