/**
 * Connection health per external system.
 *
 * Every client records each call here, so a broken connection shows on the
 * Health page and the home strip within one run. Only connection-level
 * failures count: a revoked token or an outage, not one message to a wrong
 * channel.
 */

import { IntegrationStatus, type PrismaClient } from "@prisma/client";

/** Slack error codes that mean the connection itself is broken. */
const AUTH_ERRORS = new Set(["invalid_auth", "not_authed", "token_revoked", "token_expired", "account_inactive", "org_login_required"]);
const THROTTLE_ERRORS = new Set(["ratelimited", "rate_limited"]);
/** Slack answered, so the connection works; the request itself was wrong. */
const NETWORK_SIGNS = /fetch failed|ECONN|ETIMEDOUT|ENOTFOUND|socket|network|request_failed/i;

export type CallOutcome = { ok: boolean; error?: string };

export function classify(outcome: CallOutcome): IntegrationStatus | null {
  if (outcome.ok) return IntegrationStatus.OK;
  const error = outcome.error ?? "";
  if (error === "slack_not_configured") return null;
  if (AUTH_ERRORS.has(error)) return IntegrationStatus.DOWN;
  if (THROTTLE_ERRORS.has(error) || NETWORK_SIGNS.test(error)) return IntegrationStatus.DEGRADED;
  return IntegrationStatus.OK;
}

export async function recordIntegrationCall(db: PrismaClient, name: string, outcome: CallOutcome, now = new Date()) {
  const status = classify(outcome);
  if (!status) return;
  const data =
    status === IntegrationStatus.OK
      ? { status, lastSuccessAt: now }
      : { status, lastErrorAt: now, lastError: outcome.error ?? "unknown" };
  await db.integration.upsert({ where: { name }, create: { name, ...data }, update: data });
}

/**
 * The same, for code that has no database handle to hand (the Slack client).
 * Never throws and never delays the caller: health tracking must not be the
 * reason a message fails.
 */
export function trackIntegrationCall(name: string, outcome: CallOutcome) {
  void import("./db")
    .then(({ prisma }) => recordIntegrationCall(prisma, name, outcome))
    .catch(() => {});
}
