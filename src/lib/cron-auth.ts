/**
 * Guard for the cron endpoints.
 *
 * Deliberately separate from lib/guards.ts: these endpoints authenticate with a
 * shared secret rather than a session, so this must not drag in the auth stack.
 */

export class CronAuthError extends Error {
  readonly status: number;

  constructor(message: string, status = 401) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/**
 * A request without a matching secret is rejected outright — these endpoints
 * mutate everyone's data.
 */
export function assertCronSecret(request: Request): void {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    throw new CronAuthError("Cron is not configured", 500);
  }
  const provided = request.headers.get("x-cron-secret");
  if (!provided || !timingSafeEqual(provided, expected)) {
    throw new CronAuthError("Unauthorised", 401);
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
