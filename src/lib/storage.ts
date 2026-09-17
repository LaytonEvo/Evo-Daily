/**
 * Attachment storage, on any S3-compatible bucket (Cloudflare R2 by default).
 *
 * Bytes never pass through this app. The browser uploads straight to the
 * bucket with a presigned PUT, and downloads come back through a presigned GET
 * that expires. That keeps large files off the Next.js server, which on Railway
 * is the thing that falls over first.
 *
 * Env-gated like Slack: with no bucket configured, attachments report
 * themselves unavailable and comments carry on working as text.
 *
 *   S3_BUCKET             bucket name
 *   S3_ENDPOINT           e.g. https://<account>.r2.cloudflarestorage.com
 *   S3_ACCESS_KEY_ID
 *   S3_SECRET_ACCESS_KEY
 *   S3_REGION             optional, defaults to "auto" (what R2 wants)
 */

import crypto from "node:crypto";
import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/** 10MB. A photo of a stockroom shelf, not a video. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/**
 * What a phone camera and a scanner produce, plus PDFs. Deliberately a list
 * rather than a wildcard: an uploaded .html or .svg served back from our own
 * origin would run as our origin.
 */
export const ALLOWED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "application/pdf",
  "text/plain",
  "text/csv",
]);

export function storageEnabled(): boolean {
  return Boolean(
    process.env.S3_BUCKET &&
      process.env.S3_ENDPOINT &&
      process.env.S3_ACCESS_KEY_ID &&
      process.env.S3_SECRET_ACCESS_KEY,
  );
}

let client: S3Client | null = null;
function getClient(): S3Client {
  client ??= new S3Client({
    region: process.env.S3_REGION || "auto",
    endpoint: process.env.S3_ENDPOINT,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
    // R2 and most S3-compatibles want path-style addressing.
    forcePathStyle: true,
  });
  return client;
}

/**
 * The key the bytes live under. Built entirely server-side from random data —
 * a client-supplied key is a path-traversal hole and a way to guess at
 * someone else's file.
 *
 * The organisation prefix is for operators reading the bucket, not for access
 * control; authorisation is the database's job on every request.
 */
export function buildStorageKey(organisationId: string, filename: string): string {
  const extension = filename.includes(".")
    ? "." + filename.split(".").pop()!.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8)
    : "";
  return `${organisationId}/${crypto.randomUUID()}${extension}`;
}

/** A URL the browser can PUT to, for a few minutes. */
export function presignUpload(key: string, contentType: string): Promise<string> {
  return getSignedUrl(
    getClient(),
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET!,
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn: 300 },
  );
}

/**
 * A short-lived download URL. Short because it is a bearer token in a query
 * string: anyone it is forwarded to can read the file until it expires.
 */
export function presignDownload(key: string, filename: string): Promise<string> {
  return getSignedUrl(
    getClient(),
    new GetObjectCommand({
      Bucket: process.env.S3_BUCKET!,
      Key: key,
      // Force a download rather than letting the browser render it inline.
      ResponseContentDisposition: `attachment; filename="${filename.replace(/["\\]/g, "")}"`,
    }),
    { expiresIn: 300 },
  );
}

/** Best effort. An orphaned object costs a fraction of a penny; a failed
 *  delete must not fail the request that removed the row. */
export async function deleteObject(key: string): Promise<void> {
  try {
    await getClient().send(
      new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET!, Key: key }),
    );
  } catch {
    // Swallowed deliberately — see above.
  }
}
