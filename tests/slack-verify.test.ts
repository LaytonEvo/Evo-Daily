import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifySlackRequest } from "@/lib/slack-verify";

const SECRET = "8f742231b10e8888abcd99yyyzzz85a5";
const NOW = new Date("2026-09-01T12:00:00Z");

function sign(body: string, at: Date = NOW, secret = SECRET) {
  const ts = Math.floor(at.getTime() / 1000).toString();
  const signature =
    "v0=" + crypto.createHmac("sha256", secret).update(`v0:${ts}:${body}`).digest("hex");
  return new Headers({ "x-slack-request-timestamp": ts, "x-slack-signature": signature });
}

describe("verifySlackRequest", () => {
  const body = '{"type":"event_callback","event":{"text":"done"}}';

  it("accepts a request Slack signed", () => {
    expect(verifySlackRequest(body, sign(body), { now: NOW, secret: SECRET })).toEqual({ ok: true });
  });

  it("rejects a body altered after signing", () => {
    // The attack this exists for: a captured request replayed with a different
    // task id, or a different Slack user, in the body.
    const headers = sign(body);
    const tampered = body.replace("done", "done everything");
    const result = verifySlackRequest(tampered, headers, { now: NOW, secret: SECRET });
    expect(result).toEqual({ ok: false, reason: "signature_mismatch" });
  });

  it("rejects a signature made with a different secret", () => {
    const headers = sign(body, NOW, "not-the-real-secret");
    expect(verifySlackRequest(body, headers, { now: NOW, secret: SECRET })).toEqual({
      ok: false,
      reason: "signature_mismatch",
    });
  });

  it("rejects a replay of a genuinely signed request", () => {
    const headers = sign(body, new Date(NOW.getTime() - 6 * 60_000));
    expect(verifySlackRequest(body, headers, { now: NOW, secret: SECRET })).toEqual({
      ok: false,
      reason: "stale_timestamp",
    });
  });

  it("accepts one inside the replay window", () => {
    const headers = sign(body, new Date(NOW.getTime() - 4 * 60_000));
    expect(verifySlackRequest(body, headers, { now: NOW, secret: SECRET }).ok).toBe(true);
  });

  it("rejects a timestamp from the future beyond the window", () => {
    const headers = sign(body, new Date(NOW.getTime() + 6 * 60_000));
    expect(verifySlackRequest(body, headers, { now: NOW, secret: SECRET }).ok).toBe(false);
  });

  it("rejects a request with no signature headers", () => {
    expect(verifySlackRequest(body, new Headers(), { now: NOW, secret: SECRET })).toEqual({
      ok: false,
      reason: "missing_signature_headers",
    });
  });

  it("rejects a non-numeric timestamp", () => {
    const headers = new Headers({
      "x-slack-request-timestamp": "not-a-number",
      "x-slack-signature": "v0=abc",
    });
    expect(verifySlackRequest(body, headers, { now: NOW, secret: SECRET })).toEqual({
      ok: false,
      reason: "bad_timestamp",
    });
  });

  it("rejects a truncated signature rather than throwing", () => {
    // timingSafeEqual throws on unequal lengths; a thrown error here would be
    // a 500 instead of a clean rejection.
    const headers = new Headers({
      "x-slack-request-timestamp": Math.floor(NOW.getTime() / 1000).toString(),
      "x-slack-signature": "v0=abc",
    });
    expect(verifySlackRequest(body, headers, { now: NOW, secret: SECRET })).toEqual({
      ok: false,
      reason: "signature_mismatch",
    });
  });

  it("refuses everything when no signing secret is configured", () => {
    // Fail closed: an unconfigured deployment must not accept unsigned calls.
    expect(verifySlackRequest(body, sign(body), { now: NOW, secret: null })).toEqual({
      ok: false,
      reason: "slack_signing_secret_not_set",
    });
  });
});
