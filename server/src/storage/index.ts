import {
  CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config.ts';

const client = new S3Client({
  endpoint: config.S3_ENDPOINT,
  region: 'auto',
  forcePathStyle: true,
  // Otherwise presigned PUTs carry a checksum of an empty body and every upload fails.
  requestChecksumCalculation: 'WHEN_REQUIRED',
  credentials: { accessKeyId: config.S3_ACCESS_KEY_ID, secretAccessKey: config.S3_SECRET_ACCESS_KEY },
});
const Bucket = config.S3_BUCKET;
const EXPIRES_IN = 15 * 60;
const RASTER = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif']);

/** tenant/<t>/brand/<b>/<kind>/<id>.<ext>: IDs only, never a user's file name. */
export function objectKey(
  tenantId: string, brandId: string, kind: 'upload' | 'snapshot' | 'asset', id: string, ext: string,
): string {
  return `tenant/${tenantId}/brand/${brandId}/${kind}/${id}.${ext}`;
}

export async function putObject(key: string, body: Uint8Array, contentType: string): Promise<void> {
  await client.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType }));
}

export async function getObject(key: string): Promise<Uint8Array> {
  const res = await client.send(new GetObjectCommand({ Bucket, Key: key }));
  return res.Body!.transformToByteArray();
}

/** The stored object's size in bytes (HEAD, no body); throws when it is missing. */
export async function objectSize(key: string): Promise<number> {
  return (await client.send(new HeadObjectCommand({ Bucket, Key: key }))).ContentLength ?? 0;
}

export async function deleteObject(key: string): Promise<void> {
  await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
}

/**
 * A short-lived URL the browser PUTs the file to, with this Content-Type.
 * shortcut: a presigned PUT cannot cap the size, so completeUpload checks maxBytes on the stored
 * object; move to a presigned POST with content-length-range if large rejected uploads cost too much.
 */
export async function presignUpload(key: string, contentType: string, maxBytes: number): Promise<string> {
  void maxBytes;
  return getSignedUrl(client, new PutObjectCommand({ Bucket, Key: key, ContentType: contentType }), {
    expiresIn: EXPIRES_IN,
  });
}

/** A short-lived download URL. Anything but a raster image comes back as an attachment, never inline. */
export async function presignDownload(key: string): Promise<string> {
  const ext = key.slice(key.lastIndexOf('.') + 1).toLowerCase();
  const command = new GetObjectCommand({
    Bucket,
    Key: key,
    ResponseContentDisposition: RASTER.has(ext) ? undefined : 'attachment',
  });
  return getSignedUrl(client, command, { expiresIn: EXPIRES_IN });
}

/** Creates the bucket if it is missing. Runs at startup and in tests. */
export async function ensureBucket(): Promise<void> {
  try {
    await client.send(new CreateBucketCommand({ Bucket }));
  } catch (e) {
    const name = (e as Error).name;
    if (name !== 'BucketAlreadyOwnedByYou' && name !== 'BucketAlreadyExists') throw e;
  }
}
