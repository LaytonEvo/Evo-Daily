/**
 * When a signed-in session stops counting, and who may sign in with Google.
 *
 * Kept free of the auth stack so the rules can be tested on their own.
 */

/** A session ends after this long without a page load. */
export const IDLE_LIMIT_MS = 12 * 60 * 60 * 1000;

export const ALLOWED_GOOGLE_DOMAIN = (process.env.ALLOWED_GOOGLE_DOMAIN ?? "evolutiongolf.co.uk").toLowerCase();

/**
 * Whether a session is still good.
 *
 * Idle time runs from the later of the person's last page load and when this
 * session was issued, so signing in again after a long gap starts the clock
 * afresh. A session with neither (a token from before this rule existed, for
 * someone who has never loaded a page) is let through rather than guessed at.
 *
 * An admin's force sign-out sets sessionsRevokedAt: anything issued before it
 * is refused. A token too old to say when it was issued is refused too.
 */
export function sessionIsLive(
  user: { lastActiveAt: Date | null; sessionsRevokedAt: Date | null },
  issuedAt: number | null | undefined,
  now: Date = new Date(),
): boolean {
  if (user.sessionsRevokedAt && (!issuedAt || issuedAt < user.sessionsRevokedAt.getTime())) {
    return false;
  }
  const lastSeen = Math.max(user.lastActiveAt?.getTime() ?? 0, issuedAt ?? 0);
  if (lastSeen === 0) return true;
  return now.getTime() - lastSeen <= IDLE_LIMIT_MS;
}

/**
 * A Google account may sign in only if Google has verified the address and it
 * belongs to the company Workspace. Checking `hd` as well as the address stops
 * a personal Google account that happens to use a company address.
 */
export function isAllowedGoogleProfile(profile: {
  email?: string | null;
  email_verified?: unknown;
  hd?: unknown;
} | null | undefined): boolean {
  const email = profile?.email?.toLowerCase();
  if (!email || profile?.email_verified !== true) return false;
  return email.endsWith(`@${ALLOWED_GOOGLE_DOMAIN}`) && profile?.hd === ALLOWED_GOOGLE_DOMAIN;
}
