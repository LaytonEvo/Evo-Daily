/**
 * The data behind /my-day.
 *
 * A member should be able to clear their day in under 60 seconds on a phone,
 * so this returns exactly the three sections the screen renders and nothing
 * else — no counts to compute client-side, no second round trip.
 */

import { InstanceStatus, type PrismaClient } from "@prisma/client";
import { generateInstances } from "./recurrence";
import { getSettings } from "./settings";
import { daysLate } from "./instances";
import {
  addDays,
  compareDateOnly,
  formatTimeLondon,
  toDateOnly,
  toDbDate,
  todayInLondon,
  type DateOnly,
} from "./time";

export type MyDayTask = {
  id: string;
  title: string;
  description: string | null;
  dueDate: DateOnly;
  dueTimeLabel: string | null;
  status: InstanceStatus;
  note: string | null;
  wasLate: boolean;
  daysLate: number;
  categoryName: string | null;
  categoryColour: string | null;
  /** Whether this member may still tick or untick it themselves. */
  editable: boolean;
};

export type MyDay = {
  today: DateOnly;
  overdue: MyDayTask[];
  dueToday: MyDayTask[];
  doneToday: MyDayTask[];
  /** Progress ring: everything owed today, and how much of it is cleared. */
  owedTotal: number;
  owedDone: number;
};

/**
 * Belt and braces against a failed cron or a sleeping Railway service: make
 * sure today exists before the screen renders. Generation is idempotent, so
 * calling this on every page load is safe.
 */
export async function ensureInstancesForToday(
  db: PrismaClient,
  organisationId: string,
  today: DateOnly = todayInLondon(),
): Promise<void> {
  await generateInstances(db, today, today, { organisationId });
}

export async function getMyDay(
  db: PrismaClient,
  user: { id: string; organisationId: string },
  today: DateOnly = todayInLondon(),
): Promise<MyDay> {
  const { graceDays } = await getSettings(db, user.organisationId);

  // Today, and back only as far as a member can still act on. Nothing ahead:
  // the screen is what you owe now, and a list of work that is not yet due
  // reads as a backlog you are already behind on.
  const from = addDays(today, -graceDays);
  const to = today;

  const rows = await db.taskInstance.findMany({
    where: {
      assigneeId: user.id,
      organisationId: user.organisationId,
      dueDate: { gte: toDbDate(from), lte: toDbDate(to) },
    },
    include: {
      category: { select: { name: true, colour: true } },
      template: { select: { description: true } },
    },
    orderBy: [{ dueDate: "asc" }, { dueAt: "asc" }, { title: "asc" }],
  });

  const tasks: MyDayTask[] = rows.map((row) => {
    const dueDate = toDateOnly(row.dueDate);
    return {
      id: row.id,
      title: row.title,
      description: row.template.description,
      dueDate,
      // A cut-off time is only worth showing when one was actually set.
      dueTimeLabel:
        row.dueAt && !isEndOfDay(row.dueAt) ? formatTimeLondon(row.dueAt) : null,
      status: row.status,
      note: row.note,
      wasLate: row.wasLate,
      daysLate: daysLate(dueDate, today),
      categoryName: row.category?.name ?? null,
      categoryColour: row.category?.colour ?? null,
      // MISSED instances never reach this screen, so anything here is inside
      // the grace window by construction.
      editable: row.status !== InstanceStatus.MISSED,
    };
  });

  const open = tasks.filter((t) => t.status === InstanceStatus.PENDING);
  const done = tasks.filter((t) => t.status === InstanceStatus.COMPLETED);

  const overdue = open.filter((t) => compareDateOnly(t.dueDate, today) < 0);
  const dueToday = open.filter((t) => t.dueDate === today);

  // Everything cleared from what was owed — today's work, and any catch-up on
  // an overdue item.
  const doneToday = done;

  const owedTotal = overdue.length + dueToday.length + doneToday.length;
  const owedDone = doneToday.length;

  return { today, overdue, dueToday, doneToday, owedTotal, owedDone };
}

function isEndOfDay(instant: Date): boolean {
  return formatTimeLondon(instant) === "23:59";
}
