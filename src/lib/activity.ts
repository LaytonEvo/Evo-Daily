/**
 * Whether people are actually using it.
 *
 * The sign-in log answers a different question to the one anybody asks of it.
 * A session cookie lasts thirty days, so a sign-in row is written the once,
 * when somebody first types a password — after which they can use the app
 * every morning for a month and appear, from the log, to have vanished. The
 * People table even called that "Last seen", which was the wrong name for a
 * real number and the most misleading thing on the page.
 *
 * So activity is recorded where activity happens: on page loads. Rolled up to
 * one row per person per day, because "are they opening this" is a question a
 * day answers, and a row per request answers worse and forever.
 */

import type { PrismaClient } from "@prisma/client";
import { toDbDate, todayInLondon, type DateOnly } from "./time";

/**
 * How long before the same person counts again.
 *
 * Every guarded page load would otherwise be a write, and a tab left open on
 * a refresh loop would read as the busiest person in the business. Two minutes
 * makes `visits` a count of spells at the screen rather than of requests, which
 * is the thing worth counting.
 */
export const ACTIVITY_THROTTLE_MS = 2 * 60 * 1000;

/**
 * Note that somebody is using it, at most once every couple of minutes.
 *
 * Swallows its own errors. This is a usage statistic: it must never be the
 * reason somebody cannot open their day.
 */
export async function recordActivity(
  db: PrismaClient,
  user: { id: string; lastActiveAt: Date | null },
  now: Date = new Date(),
): Promise<boolean> {
  if (user.lastActiveAt && now.getTime() - user.lastActiveAt.getTime() < ACTIVITY_THROTTLE_MS) {
    return false;
  }

  try {
    const day = toDbDate(todayInLondon(now));
    await db.$transaction([
      db.user.update({ where: { id: user.id }, data: { lastActiveAt: now } }),
      db.dailyActivity.upsert({
        where: { userId_day: { userId: user.id, day } },
        create: { userId: user.id, day, visits: 1, lastAt: now },
        update: { visits: { increment: 1 }, lastAt: now },
      }),
    ]);
    return true;
  } catch {
    return false;
  }
}

export type ActivityRow = {
  userId: string;
  lastActiveAt: Date | null;
  /** Newest first, one per day they opened it. */
  days: { day: DateOnly; visits: number }[];
};

/**
 * Recent activity per person.
 *
 * Returns the days themselves rather than a count, so the screen can show
 * which days somebody was in — four days in a row and four days spread over a
 * fortnight are not the same news, and a single number cannot tell them apart.
 */
export async function recentActivity(
  db: PrismaClient,
  organisationId: string,
  days = 14,
  today: DateOnly = todayInLondon(),
): Promise<Map<string, ActivityRow>> {
  const from = new Date(toDbDate(today));
  from.setUTCDate(from.getUTCDate() - (days - 1));

  const [users, rows] = await Promise.all([
    db.user.findMany({
      where: { organisationId },
      select: { id: true, lastActiveAt: true },
    }),
    db.dailyActivity.findMany({
      where: { user: { organisationId }, day: { gte: from } },
      orderBy: { day: "desc" },
      select: { userId: true, day: true, visits: true },
    }),
  ]);

  const byUser = new Map<string, ActivityRow>(
    users.map((u) => [u.id, { userId: u.id, lastActiveAt: u.lastActiveAt, days: [] }]),
  );
  for (const row of rows) {
    byUser.get(row.userId)?.days.push({
      day: row.day.toISOString().slice(0, 10) as DateOnly,
      visits: row.visits,
    });
  }
  return byUser;
}
