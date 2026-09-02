/**
 * Slack request verification.
 *
 * This is the security boundary for everything inbound. Anyone on the internet
 * can POST to the events endpoint, and the payload names the Slack user it
 * claims to be from — so without this, marking someone else's task complete, or
 * creating tasks as an admin, is a curl away.
 *
 * Slack signs every request with the app's signing secret. We recompute the
 * signature over the exact bytes received and compare in constant time.
 */

import crypto from "node:crypto";

/** Slack's documented replay window. */
const MAX_AGE_SECONDS = 60 * 5;

export type VerifyResult = { ok: true } | { ok: false; reason: string };

export function slackSigningSecret(): string | null {
  return process.env.SLACK_SIGNING_SECRET || null;
}

/**
 * `rawBody` must be the untouched request body. Re-serialising parsed JSON
 * changes bytes — key order, whitespace, unicode escaping — and the signature
 * will not match.
 */
export function verifySlackRequest(
  rawBody: string,
  headers: Headers,
  options: { now?: Date; secret?: string | null } = {},
): VerifyResult {
  const secret = options.secret ?? slackSigningSecret();
  if (!secret) return { ok: false, reason: "slack_signing_secret_not_set" };

  const timestamp = headers.get("x-slack-request-timestamp");
  const signature = headers.get("x-slack-signature");
  if (!timestamp || !signature) return { ok: false, reason: "missing_signature_headers" };

  const sent = Number(timestamp);
  if (!Number.isFinite(sent)) return { ok: false, reason: "bad_timestamp" };

  // Rejects replays of a captured request. Also rejects a request from a
  // badly-skewed clock, which is the right call — we cannot tell the two apart.
  const now = options.now ?? new Date();
  const ageSeconds = Math.abs(Math.floor(now.getTime() / 1000) - sent);
  if (ageSeconds > MAX_AGE_SECONDS) return { ok: false, reason: "stale_timestamp" };

  const expected =
    "v0=" +
    crypto.createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`).digest("hex");

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  // timingSafeEqual throws on a length mismatch, which is itself a signal, so
  // check length first and keep the comparison constant time.
  if (a.length !== b.length) return { ok: false, reason: "signature_mismatch" };
  if (!crypto.timingSafeEqual(a, b)) return { ok: false, reason: "signature_mismatch" };

  return { ok: true };
}
