/**
 * The data behind /my-day.
 *
 * A member should be able to clear their day in under 60 seconds on a phone,
 * so this returns exactly the three sections the screen renders and nothing
 * else — no counts to compute client-side, no second round trip.
 */

import { Frequency, InstanceStatus, Role, type PrismaClient } from "@prisma/client";
import { generateInstances } from "./recurrence";
import { getSettings } from "./settings";
import { daysLate } from "./instances";
import { leadDaysFor } from "./lead-time";
import {
  addDays,
  compareDateOnly,
  daysBetween,
  endOfDayLondon,
  formatTimeLondon,
  maxDateOnly,
  startOfDayLondon,
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
  /** Pinned to the top of the day, above the clock. */
  starred: boolean;
  /**
   * Due after today. Set on the Coming up list and nowhere else, so the screen
   * never has to compare dates to know which half of it it is drawing.
   */
  upcoming?: boolean;
  /** This one has reached its lead time — it wants to be seen now. */
  withinLead?: boolean;
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
  /**
   * Work due after today, nearest first. Deliberately not folded into the
   * sections above: the day is what you owe now, and a list you cannot finish
   * is the thing this screen exists not to be. The screen shows the ones whose
   * lead time has arrived, and the rest only once today is clear.
   */
  comingUp: MyDayTask[];
};

/** Never look further ahead than generation reliably goes. */
export const COMING_UP_DAYS = 14;

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
      OR: [
        { dueDate: { gte: toDbDate(from), lte: toDbDate(to) } },
        // Anything finished today, whatever day it was due for. Without this,
        // ticking next Friday's task on Tuesday makes it disappear: it is not
        // in the window, so no Done row appears and the ring does not move.
        // Work that vanishes when you do it is how people stop trusting a
        // screen.
        {
          status: InstanceStatus.COMPLETED,
          completedAt: { gte: startOfDayLondon(today), lte: endOfDayLondon(today) },
        },
      ],
    },
    include: {
      category: { select: { name: true, colour: true } },
      // isStarred is read live rather than frozen onto the instance: starring
      // is a statement about what matters now, so it has to reach today's list.
      template: {
        select: { description: true, isStarred: true, frequency: true, leadDays: true },
      },
    },
    orderBy: [{ dueDate: "asc" }, { dueAt: "asc" }, { title: "asc" }],
  });

  const tasks: MyDayTask[] = rows.map((row) => toTask(row, today));

  const comingUp = await getComingUp(db, user, today);

  // Starred first, then the order the query already put them in. A star is a
  // manager saying "this one before the others", which is only worth anything
  // if it survives a task with an earlier cut-off time sitting below it.
  const byStar = <T extends { starred: boolean }>(rows: T[]): T[] => [
    ...rows.filter((r) => r.starred),
    ...rows.filter((r) => !r.starred),
  ];

  const open = tasks.filter((t) => t.status === InstanceStatus.PENDING);
  const done = tasks.filter((t) => t.status === InstanceStatus.COMPLETED);

  const overdue = byStar(open.filter((t) => compareDateOnly(t.dueDate, today) < 0));
  const dueToday = byStar(open.filter((t) => t.dueDate === today));

  // Everything cleared from what was owed — today's work, any catch-up on an
  // overdue item, and anything pulled forward from a later day.
  const doneToday = done;

  // The ring is today's work and only today's. A task pulled forward from next
  // week belongs in Done today — somebody did it today — but counting it here
  // would let anyone improve the number without touching what is actually
  // owed, and would make the two still open look like less of the day than
  // they are.
  const clearedToday = doneToday.filter((t) => compareDateOnly(t.dueDate, today) <= 0);
  const owedTotal = overdue.length + dueToday.length + clearedToday.length;
  const owedDone = clearedToday.length;

  return { today, overdue, dueToday, doneToday, owedTotal, owedDone, comingUp };
}

function isEndOfDay(instant: Date): boolean {
  return formatTimeLondon(instant) === "23:59";
}

type InstanceRow = {
  id: string;
  title: string;
  dueDate: Date;
  dueAt: Date | null;
  status: InstanceStatus;
  note: string | null;
  wasLate: boolean;
  category: { name: string; colour: string | null } | null;
  template: {
    description: string | null;
    isStarred: boolean;
    frequency: Frequency;
    leadDays: number | null;
  };
};

/**
 * Work due after today, nearest first.
 *
 * Every one of these already exists — generation runs two weeks ahead — so
 * this is a question about what to draw, not what to create. Each carries
 * whether its lead time has arrived, and the screen decides from there: the
 * ones asking to be seen go under the day, and the rest wait for a day that
 * is already clear.
 */
export async function getComingUp(
  db: PrismaClient,
  user: { id: string; organisationId: string },
  today: DateOnly = todayInLondon(),
): Promise<MyDayTask[]> {
  const rows = await db.taskInstance.findMany({
    where: {
      assigneeId: user.id,
      organisationId: user.organisationId,
      status: InstanceStatus.PENDING,
      dueDate: {
        gt: toDbDate(today),
        lte: toDbDate(addDays(today, COMING_UP_DAYS)),
      },
    },
    include: {
      category: { select: { name: true, colour: true } },
      template: {
        select: { description: true, isStarred: true, frequency: true, leadDays: true },
      },
    },
    orderBy: [{ dueDate: "asc" }, { dueAt: "asc" }, { title: "asc" }],
  });

  // The next one of each, not every one of each. A weekly task shows its
  // Friday, not this Friday and next Friday and the one after — the second
  // occurrence tells you nothing the first did not and costs a row saying it.
  const nextOfEach = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!nextOfEach.has(row.templateId)) nextOfEach.set(row.templateId, row);
  }

  return (
    [...nextOfEach.values()]
      /**
       * Zero notice means zero notice, on a clear day as much as a busy one.
       *
       * This is what keeps the list useful rather than long. A daily task
       * pulled forward is nonsense — tomorrow's ball count is a different
       * count, and doing it today helps nobody — so showing four of them the
       * moment somebody finishes early buries the weekly check and the
       * monthly stocktake, which are the two things worth starting.
       */
      .filter((row) => leadDaysFor(row.template) > 0)
      .map((row) => {
        const task = toTask(row, today);
        const dueIn = daysBetween(today, task.dueDate);
        return {
          ...task,
          upcoming: true,
          withinLead: dueIn <= leadDaysFor(row.template),
          // Nothing ahead is late, whatever the arithmetic says about the date.
          daysLate: 0,
        };
      })
  );
}

/** One row, as the screen wants it. Shared so a preview cannot drift. */
function toTask(row: InstanceRow, today: DateOnly): MyDayTask {
  const dueDate = toDateOnly(row.dueDate);
  return {
    id: row.id,
    title: row.title,
    description: row.template.description,
    dueDate,
    // A cut-off time is only worth showing when one was actually set.
    dueTimeLabel: row.dueAt && !isEndOfDay(row.dueAt) ? formatTimeLondon(row.dueAt) : null,
    status: row.status,
    note: row.note,
    wasLate: row.wasLate,
    daysLate: daysLate(dueDate, today),
    categoryName: row.category?.name ?? null,
    categoryColour: row.category?.colour ?? null,
    starred: row.template.isStarred,
    // MISSED instances never reach this screen, so anything here is inside
    // the grace window by construction.
    editable: row.status !== InstanceStatus.MISSED,
  };
}

/**
 * A day that has not happened yet.
 *
 * Deliberately not getMyDay with a later date: that would pull in the grace
 * window as well, and tomorrow's screen would open on a list of things that
 * are overdue *today* relabelled as tomorrow's backlog. A future day is just
 * what is due on it.
 *
 * Nothing on it is done, nothing on it is late, so the sections collapse to
 * one and the progress ring reads 0 of n — which is what a day nobody has
 * started looks like.
 */
export async function getUpcomingDay(
  db: PrismaClient,
  user: { id: string; organisationId: string },
  date: DateOnly,
): Promise<MyDay> {
  const rows = await db.taskInstance.findMany({
    where: {
      assigneeId: user.id,
      organisationId: user.organisationId,
      dueDate: toDbDate(date),
    },
    include: {
      category: { select: { name: true, colour: true } },
      template: {
        select: { description: true, isStarred: true, frequency: true, leadDays: true },
      },
    },
    orderBy: [{ dueAt: "asc" }, { title: "asc" }],
  });

  const tasks = rows
    .filter((row) => row.status !== InstanceStatus.EXCUSED)
    .map((row) => toTask(row, date));
  const dueToday = [...tasks.filter((t) => t.starred), ...tasks.filter((t) => !t.starred)];

  return {
    today: date,
    overdue: [],
    dueToday,
    doneToday: [],
    owedTotal: dueToday.length,
    owedDone: 0,
    // A preview of a single future day is already the answer to "what is
    // coming"; a list of what is coming after it would be a different question.
    comingUp: [],
  };
}

export type ViewedDay = {
  person: { id: string; name: string; isActive: boolean };
  day: MyDay;
  /** The date being shown. */
  on: DateOnly;
  isToday: boolean;
};

/**
 * Somebody else's day, for an admin.
 *
 * "What is Brad actually looking at this morning?" is a question the reports
 * screen answers in aggregate and never in the shape the person sees, and an
 * admin asking it was reduced to reading a table of rows and imagining the
 * screen.
 *
 * Two rules, both enforced here rather than in the page, because a page is one
 * caller and this is the thing worth getting right:
 *
 *  - Admins only. A member reaching this by editing a URL gets nothing.
 *  - The same organisation. The id comes from the URL, so it is untrusted;
 *    without this check an admin could read any user id in the database.
 *
 * Returns null for both, so the caller renders a 404 and neither case reveals
 * whether that id exists.
 */
export async function getDayFor(
  db: PrismaClient,
  actor: { role: Role; organisationId: string },
  userId: string,
  options: { on?: DateOnly; today?: DateOnly } = {},
): Promise<ViewedDay | null> {
  if (actor.role !== Role.ADMIN) return null;

  const person = await db.user.findFirst({
    where: { id: userId, organisationId: actor.organisationId },
    select: { id: true, name: true, isActive: true, organisationId: true },
  });
  if (!person) return null;

  const today = options.today ?? todayInLondon();
  // Only forward, and a past date clamps to today rather than being echoed
  // back — returning "you are looking at last Tuesday" above today's list is
  // worse than not offering last Tuesday at all. Looking back is the report's
  // job, and it answers better: what was completed, what was missed, and when.
  const on = maxDateOnly(options.on ?? today, today);
  const who = { id: person.id, organisationId: person.organisationId };

  const day =
    compareDateOnly(on, today) > 0
      ? await getUpcomingDay(db, who, on)
      : await getMyDay(db, who, today);

  return {
    person: { id: person.id, name: person.name, isActive: person.isActive },
    day,
    on,
    isToday: on === today,
  };
}
