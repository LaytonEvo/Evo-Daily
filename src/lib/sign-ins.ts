/**
 * The sign-in log.
 *
 * A completion rate says whether work got ticked off. It cannot tell you
 * whether the person ever opened the app — and a member who never signs in and
 * a member who signs in and ignores their list look identical on the reports
 * while needing opposite conversations.
 *
 * Recording is deliberately best-effort. An audit row that fails to write must
 * never be the reason somebody cannot get into the platform.
 */

import { SignInOutcome, type PrismaClient } from "@prisma/client";

export type { SignInOutcome };

export type SignInRow = {
  id: string;
  at: Date;
  outcome: SignInOutcome;
  user: { id: string; name: string };
};

export async function recordSignIn(
  db: PrismaClient,
  attempt: { userId: string; organisationId: string; outcome: SignInOutcome },
): Promise<void> {
  try {
    await db.signIn.create({ data: attempt });
  } catch {
    // Logging an attempt is not worth failing the attempt over.
  }
}

/** The most recent attempts across the organisation, newest first. */
export async function recentSignIns(
  db: PrismaClient,
  organisationId: string,
  limit = 50,
): Promise<SignInRow[]> {
  return db.signIn.findMany({
    where: { organisationId },
    select: { id: true, at: true, outcome: true, user: { select: { id: true, name: true } } },
    orderBy: { at: "desc" },
    take: limit,
  });
}

/**
 * When each person last got in, and how many times over the window.
 *
 * Only successful sign-ins count: the question is whether they are using it,
 * and a fortnight of failed attempts means they are locked out, not active.
 */
export async function lastSeenByUser(
  db: PrismaClient,
  organisationId: string,
): Promise<Map<string, Date>> {
  const rows = await db.signIn.groupBy({
    by: ["userId"],
    where: { organisationId, outcome: SignInOutcome.SUCCESS },
    _max: { at: true },
  });

  const seen = new Map<string, Date>();
  for (const row of rows) {
    if (row._max.at) seen.set(row.userId, row._max.at);
  }
  return seen;
}

/** One person's attempts, newest first — for their report page. */
export async function signInsFor(
  db: PrismaClient,
  organisationId: string,
  userId: string,
  limit = 20,
): Promise<SignInRow[]> {
  return db.signIn.findMany({
    where: { organisationId, userId },
    select: { id: true, at: true, outcome: true, user: { select: { id: true, name: true } } },
    orderBy: { at: "desc" },
    take: limit,
  });
}

export function describeOutcome(outcome: SignInOutcome): string {
  switch (outcome) {
    case SignInOutcome.SUCCESS:
      return "Signed in";
    case SignInOutcome.WRONG_PASSWORD:
      return "Wrong password";
    case SignInOutcome.DEACTIVATED:
      return "Account turned off";
    default:
      return "Unknown";
  }
}
