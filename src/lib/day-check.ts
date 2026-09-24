/**
 * Asking why a day came in under half.
 *
 * The reports have always been able to show that Tuesday was 3 of 8. What they
 * could never show is why, and the why is the part that decides whether the
 * answer is a conversation about workload, a broken process, or nothing at
 * all. Asked the next morning because a reason is worth most while somebody
 * can still remember the afternoon, and worth very little by Friday.
 *
 * Asked once, and it cannot be dismissed. Everything else in the app can be
 * put off; this is the one thing the business needs a sentence about.
 */

import { InstanceStatus, Role, type PrismaClient } from "@prisma/client";
import { addDays, formatDateOnlyFull, toDbDate, todayInLondon, type DateOnly } from "./time";

/** Below this and we ask. Half of the day's work is the line. */
export const DAY_CHECK_THRESHOLD = 0.5;

/** Short enough to be one sentence, long enough that it had to be typed. */
export const MIN_REASON_LENGTH = 10;
export const MAX_REASON_LENGTH = 1000;

export type DayCheckPrompt = {
  day: DateOnly;
  /** "Tuesday 22 September", ready to print. No year: it is yesterday. */
  dayLabel: string;
  completed: number;
  total: number;
  /** The titles that were not completed, in the order they were due. */
  missed: string[];
};

type Person = { id: string; organisationId: string; role: Role };

/**
 * Whether this person owes an answer for yesterday, and what to ask about.
 *
 * Counted from completions rather than from the MISSED status, because the
 * two are not the same thing in the morning: the catch-up window leaves
 * yesterday's unfinished work PENDING until tonight's sweep, so a question
 * asked off MISSED would never fire on the day it means something.
 *
 * Excused work — booked time off — is left out of both halves of the fraction.
 * Somebody who was away for the afternoon has not had a bad day, and asking
 * them to account for it is the fastest way to teach a team that the question
 * is noise.
 */
export async function pendingDayCheck(
  db: PrismaClient,
  person: Person,
  today: DateOnly = todayInLondon(),
): Promise<DayCheckPrompt | null> {
  // Admins are not asked. The answer is addressed to the admins, so asking one
  // is asking them to write to themselves, and a manager who has learnt to
  // click through their own dialog every morning has learnt to click through
  // everybody's.
  if (person.role === Role.ADMIN) return null;

  const day = addDays(today, -1);

  const already = await db.dayCheck.findUnique({
    where: { userId_day: { userId: person.id, day: toDbDate(day) } },
    select: { id: true },
  });
  if (already) return null;

  const instances = await db.taskInstance.findMany({
    where: {
      organisationId: person.organisationId,
      assigneeId: person.id,
      // Exact, not a range. dueDate is a DATE column, and bounding it with
      // London-midnight timestamps dragged the previous day in with it: an
      // under-half morning reported 1 of 8 for a day that had four tasks on it.
      dueDate: toDbDate(day),
      status: { not: InstanceStatus.EXCUSED },
    },
    orderBy: [{ dueAt: "asc" }, { title: "asc" }],
    select: { title: true, status: true },
  });

  // Nothing due is not a bad day. Weekends and holidays fall out here without
  // needing to know anything about a working week.
  if (instances.length === 0) return null;

  const done = instances.filter((i) => i.status === InstanceStatus.COMPLETED);
  if (done.length / instances.length >= DAY_CHECK_THRESHOLD) return null;

  return {
    day,
    dayLabel: formatDateOnlyFull(day),
    completed: done.length,
    total: instances.length,
    missed: instances
      .filter((i) => i.status !== InstanceStatus.COMPLETED)
      .map((i) => i.title),
  };
}

/**
 * Record the answer.
 *
 * Re-reads the day rather than trusting the numbers the browser sends back:
 * the figures go into a record managers read weeks later, and a total that
 * came from a form post is a total somebody can edit.
 */
export async function saveDayCheck(
  db: PrismaClient,
  person: Person,
  reason: string,
  today: DateOnly = todayInLondon(),
): Promise<{ ok: true } | { ok: false; error: string }> {
  const answer = reason.trim();
  if (answer.length < MIN_REASON_LENGTH) {
    return { ok: false, error: "Tell us a little more than that." };
  }

  const prompt = await pendingDayCheck(db, person, today);
  if (!prompt) return { ok: false, error: "There is nothing to answer for yesterday." };

  await db.dayCheck.create({
    data: {
      organisationId: person.organisationId,
      userId: person.id,
      day: toDbDate(prompt.day),
      completed: prompt.completed,
      total: prompt.total,
      reason: answer.slice(0, MAX_REASON_LENGTH),
    },
  });

  return { ok: true };
}

/**
 * Who may read a given day check, and who may reply to it.
 *
 * The person it is about, and the admins — which is the whole of the rule the
 * user asked for, expressed as a role rather than as two names, so it still
 * holds the day somebody is promoted.
 */
export function canSeeDayCheck(
  viewer: { id: string; role: Role },
  check: { userId: string },
): boolean {
  return viewer.role === Role.ADMIN || check.userId === viewer.id;
}
