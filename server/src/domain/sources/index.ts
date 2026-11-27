import { createHash } from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import { sources } from '../../db/schema/core.ts';
import { isUuid, tenantOf, type Tx } from '../../db/tenant.ts';
import { NotFoundError, ValidationError } from '../../http/errors.ts';
import { deleteObject, getObject, objectKey, objectSize, presignUpload, putObject } from '../../storage/index.ts';
import { audit } from '../audit/index.ts';
import { extractText } from './extract-text.ts';
import { fetchPage } from './fetch.ts';
import { bytesMatch, MAX_UPLOAD_BYTES, UPLOAD_TYPES } from './uploads.ts';

export { FetchError, fetchPage } from './fetch.ts';
export { pickPages } from './pick-pages.ts';
export { htmlText } from './html-text.ts';
export { verifyQuote, normalizeQuote } from './verify-quote.ts';
export { MAX_UPLOAD_BYTES, UPLOAD_TYPES } from './uploads.ts';

export type Source = {
  id: string;
  brandId: string;
  kind: 'page' | 'upload';
  uri: string;
  mime: string;
  checksum: string;
  capturedAt: Date;
  objectKey: string;
  text: string | null;
  trust: 'owner' | 'brand_site' | 'external';
  meta: Record<string, unknown>;
};

const columns = {
  id: sources.id,
  brandId: sources.brandId,
  kind: sources.kind,
  uri: sources.uri,
  mime: sources.mime,
  checksum: sources.checksum,
  capturedAt: sources.capturedAt,
  objectKey: sources.objectKey,
  text: sources.text,
  trust: sources.trust,
  meta: sources.meta,
};

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
// The browser PUTs here. Its presigned URL stays valid after completion and the browser picks the
// Content-Type, so only completeUpload writes the source's own key, with the checked bytes and type.
const pendingKey = (key: string) => `${key}.pending`;

async function newId(tx: Tx): Promise<string> {
  return (await tx.execute<{ id: string }>(sql`select uuidv7() as id`)).rows[0]!.id;
}

/** Fetches a page under the fetch guards and stores it: the HTML snapshot in storage, the text on the row. */
export async function savePageSource(tx: Tx, brandId: string, url: string, trust: Source['trust']): Promise<Source> {
  const page = await fetchPage(url);
  const id = await newId(tx);
  const html = new TextEncoder().encode(page.html);
  const key = objectKey(await tenantOf(tx), brandId, 'snapshot', id, 'html');
  await putObject(key, html, 'text/html; charset=utf-8');
  const [row] = await tx
    .insert(sources)
    .values({
      id, brandId, kind: 'page', uri: page.finalUrl, mime: 'text/html', checksum: sha256(html),
      capturedAt: new Date(), objectKey: key, text: page.text, trust,
      meta: { title: page.title, requestedUrl: url },
    })
    .returning(columns);
  return row!;
}

/**
 * Registers an upload and returns a presigned URL to PUT it to. The object key holds IDs only;
 * the file name is kept in meta.filename. The file is checked when the upload is completed.
 */
export async function createUpload(
  tx: Tx, brandId: string, f: { filename: string; mime: string; bytes: number },
): Promise<{ source: Source; uploadUrl: string }> {
  const ext = UPLOAD_TYPES[f.mime];
  if (!ext) throw new ValidationError(`Files of type ${f.mime} cannot be uploaded`);
  if (!Number.isInteger(f.bytes) || f.bytes < 1 || f.bytes > MAX_UPLOAD_BYTES)
    throw new ValidationError('A file must be between 1 byte and 25 MB');
  const id = await newId(tx);
  const key = objectKey(await tenantOf(tx), brandId, 'upload', id, ext);
  const [row] = await tx
    .insert(sources)
    .values({
      id, brandId, kind: 'upload', uri: `upload:${id}`, mime: f.mime, checksum: '', objectKey: key,
      trust: 'owner', meta: { filename: f.filename, bytes: f.bytes, uploader: 'operator', status: 'pending' },
    })
    .returning(columns);
  return { source: row!, uploadUrl: await presignUpload(pendingKey(key), f.mime, f.bytes) };
}

/**
 * Checks an uploaded file (size, magic bytes against the declared type, PDF pages) and stores its
 * checksum and text. A file that fails is deleted from storage and the call throws ValidationError.
 */
export async function completeUpload(tx: Tx, brandId: string, sourceId: string): Promise<Source> {
  const source = await getSource(tx, brandId, sourceId);
  if (source.kind !== 'upload') throw new ValidationError('Only an upload can be completed');
  if (source.meta.status === 'ready') return source;

  const pending = pendingKey(source.objectKey);
  let size: number;
  try {
    size = await objectSize(pending);
  } catch {
    throw new ValidationError('The file has not been uploaded yet');
  }
  if (size > MAX_UPLOAD_BYTES) {
    await deleteObject(pending);
    throw new ValidationError('The file is larger than 25 MB');
  }
  let bytes: Uint8Array;
  try {
    bytes = await getObject(pending);
  } catch {
    throw new ValidationError('The file has not been uploaded yet');
  }
  let extracted: Awaited<ReturnType<typeof extractText>>;
  try {
    if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new ValidationError('The file is larger than 25 MB');
    if (!bytesMatch(source.mime, bytes)) throw new ValidationError(`The file's contents are not ${source.mime}`);
    extracted = await extractText(bytes, source.mime);
  } catch (e) {
    await deleteObject(pending);
    if (e instanceof ValidationError) throw e;
    throw new ValidationError(`The file could not be read as ${source.mime}`);
  }
  await putObject(source.objectKey, bytes, source.mime);
  await deleteObject(pending);
  const meta = {
    ...source.meta,
    bytes: bytes.byteLength,
    status: 'ready',
    ...(extracted.pages ? { pages: extracted.pages } : {}),
  };
  const [row] = await tx
    .update(sources)
    .set({ checksum: sha256(bytes), capturedAt: new Date(), text: extracted.text, meta })
    .where(and(eq(sources.id, sourceId), eq(sources.brandId, brandId)))
    .returning(columns);
  await audit(tx, {
    brandId, actor: 'operator', action: 'source.upload', objectType: 'source', objectId: sourceId, result: 'ok',
  });
  return row!;
}

export async function getSource(tx: Tx, brandId: string, id: string): Promise<Source> {
  const [row] = isUuid(id)
    ? await tx.select(columns).from(sources).where(and(eq(sources.id, id), eq(sources.brandId, brandId)))
    : [];
  if (!row) throw new NotFoundError('source', id);
  return row;
}

export async function listSources(tx: Tx, brandId: string): Promise<Source[]> {
  return tx.select(columns).from(sources).where(eq(sources.brandId, brandId)).orderBy(asc(sources.createdAt));
}
