/**
 * The recurrence engine — the core of EvoTasks.
 *
 * Get this wrong and every report is worthless, so it is split in two:
 *
 *  - `dueDatesFor` is pure. Given a schedule and a window it returns calendar
 *    dates. No database, no clock, fully unit-testable.
 *  - `generateInstances` writes those dates to the database. It is idempotent
 *    by construction: one upsert per (template, dueDate) against the unique
 *    constraint, and it never deletes an existing instance.
 */

import { Frequency, InstanceStatus, type Prisma, type PrismaClient } from "@prisma/client";
import {
  addDays,
  addMonths,
  compareDateOnly,
  daysInMonth,
  dueAtFor,
  isoWeekday,
  maxDateOnly,
  minDateOnly,
  ordinal,
  dayName,
  startOfMonthLondon,
  toDateOnly,
  toDbDate,
  type DateOnly,
} from "./time";

export const DEFAULT_DAYS_OF_WEEK = [1, 2, 3, 4, 5];

/** The scheduling fields of a template — all `dueDatesFor` needs. */
export type Schedule = {
  frequency: Frequency;
  daysOfWeek: number[];
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  startDate: DateOnly | Date;
  endDate: DateOnly | Date | null;
};

/**
 * Every date this schedule falls due between `from` and `to` inclusive.
 *
 * DAILY   — every date whose ISO weekday is in `daysOfWeek`. Defaults to
 *           Mon–Fri; a task that fires seven days a week must say so.
 * WEEKLY  — the date in each ISO week matching `dayOfWeek`.
 * MONTHLY — `dayOfMonth` of each month, clamped to the length of that month,
 *           so 31 gives 28 Feb, 30 Apr, 31 May.
 * ONE_OFF — a single instance on `startDate`.
 */
export function dueDatesFor(
  schedule: Schedule,
  from: DateOnly | Date,
  to: DateOnly | Date,
): DateOnly[] {
  const windowStart = toDateOnly(from);
  const windowEnd = toDateOnly(to);
  if (compareDateOnly(windowStart, windowEnd) > 0) return [];

  const start = maxDateOnly(windowStart, schedule.startDate);
  const end = schedule.endDate
    ? minDateOnly(windowEnd, schedule.endDate)
    : windowEnd;
  if (compareDateOnly(start, end) > 0) return [];

  switch (schedule.frequency) {
    case Frequency.ONE_OFF: {
      const only = toDateOnly(schedule.startDate);
      return compareDateOnly(only, start) >= 0 && compareDateOnly(only, end) <= 0
        ? [only]
        : [];
    }

    case Frequency.DAILY: {
      const days = normaliseDaysOfWeek(schedule.daysOfWeek);
      if (days.length === 0) return [];
      const dates: DateOnly[] = [];
      for (let d = start; compareDateOnly(d, end) <= 0; d = addDays(d, 1)) {
        if (days.includes(isoWeekday(d))) dates.push(d);
      }
      return dates;
    }

    case Frequency.WEEKLY: {
      const target = schedule.dayOfWeek;
      if (!target || target < 1 || target > 7) return [];
      // Jump straight to the first matching weekday, then stride a week.
      const offset = (target - isoWeekday(start) + 7) % 7;
      const dates: DateOnly[] = [];
      for (
        let d = addDays(start, offset);
        compareDateOnly(d, end) <= 0;
        d = addDays(d, 7)
      ) {
        dates.push(d);
      }
      return dates;
    }

    case Frequency.MONTHLY: {
      const target = schedule.dayOfMonth;
      if (!target || target < 1 || target > 31) return [];
      const dates: DateOnly[] = [];
      // Start from the first of the start month; the clamp below handles the
      // case where this month's occurrence has already passed.
      for (
        let monthCursor = startOfMonthLondon(start);
        compareDateOnly(monthCursor, end) <= 0;
        monthCursor = addMonths(monthCursor, 1)
      ) {
        const [year, month] = monthCursor.split("-").map(Number);
        const day = Math.min(target, daysInMonth(year, month));
        const candidate = `${monthCursor.slice(0, 8)}${String(day).padStart(2, "0")}`;
        if (compareDateOnly(candidate, start) >= 0 && compareDateOnly(candidate, end) <= 0) {
          dates.push(candidate);
        }
      }
      return dates;
    }

    default:
      return [];
  }
}

function normaliseDaysOfWeek(days: number[] | null | undefined): number[] {
  if (!days || days.length === 0) return DEFAULT_DAYS_OF_WEEK;
  return Array.from(new Set(days.filter((d) => d >= 1 && d <= 7))).sort((a, b) => a - b);
}

/** The next `count` due dates from `after` — powers the admin live preview. */
export function nextDueDates(
  schedule: Schedule,
  count: number,
  after: DateOnly | Date,
): DateOnly[] {
  const from = toDateOnly(after);
  // Look far enough ahead that a monthly schedule still yields `count` dates.
  const horizonDays = schedule.frequency === Frequency.MONTHLY ? 31 * (count + 2) : 7 * (count + 2) + 14;
  return dueDatesFor(schedule, from, addDays(from, horizonDays)).slice(0, count);
}

/** "Every weekday", "Every Monday", "1st of the month" — for admin tables. */
export function describeSchedule(schedule: Schedule): string {
  switch (schedule.frequency) {
    case Frequency.DAILY: {
      const days = normaliseDaysOfWeek(schedule.daysOfWeek);
      if (days.length === 7) return "Every day";
      if (days.join() === DEFAULT_DAYS_OF_WEEK.join()) return "Every weekday";
      if (days.join() === "6,7") return "Weekends";
      return `Every ${days.map((d) => dayName(d)).join(", ")}`;
    }
    case Frequency.WEEKLY:
      return schedule.dayOfWeek ? `Every ${dayName(schedule.dayOfWeek, true)}` : "Weekly";
    case Frequency.MONTHLY:
      return schedule.dayOfMonth
        ? `${ordinal(schedule.dayOfMonth)} of the month`
        : "Monthly";
    case Frequency.ONE_OFF:
      return "One-off";
    default:
      return "";
  }
}

export type GenerateOptions = {
  /** Restrict generation to specific templates. Defaults to all active ones. */
  templateIds?: string[];
  organisationId?: string;
};

export type GenerateResult = {
  created: number;
  skipped: number;
  templatesConsidered: number;
};

type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * Generate instances for every active template across the window.
 *
 * Idempotent: running it five times in a row produces identical rows and zero
 * duplicates. Existing instances are never modified or deleted — a title
 * change on a template must not rewrite history, and a completed instance must
 * never be reset by a scheduled job.
 */
export async function generateInstances(
  db: DbClient,
  from: DateOnly | Date,
  to: DateOnly | Date,
  options: GenerateOptions = {},
): Promise<GenerateResult> {
  const windowStart = toDateOnly(from);
  const windowEnd = toDateOnly(to);

  const templates = await db.taskTemplate.findMany({
    where: {
      isActive: true,
      ...(options.templateIds ? { id: { in: options.templateIds } } : {}),
      ...(options.organisationId ? { organisationId: options.organisationId } : {}),
      startDate: { lte: toDbDate(windowEnd) },
      OR: [{ endDate: null }, { endDate: { gte: toDbDate(windowStart) } }],
    },
  });

  let created = 0;
  let skipped = 0;

  for (const template of templates) {
    const dueDates = dueDatesFor(template, windowStart, windowEnd);
    if (dueDates.length === 0) continue;

    // One query for what already exists, so the common case (nothing new to
    // do) costs a single read per template rather than a write per date.
    const existing = await db.taskInstance.findMany({
      where: { templateId: template.id, dueDate: { in: dueDates.map(toDbDate) } },
      select: { dueDate: true },
    });
    const alreadyThere = new Set(existing.map((i) => toDateOnly(i.dueDate)));

    for (const dueDate of dueDates) {
      if (alreadyThere.has(dueDate)) {
        skipped += 1;
        continue;
      }
      try {
        await db.taskInstance.create({
          data: {
            organisationId: template.organisationId,
            templateId: template.id,
            dueDate: toDbDate(dueDate),
            dueAt: dueAtFor(dueDate, template.dueTime),
            // Snapshot fields, frozen here and never updated afterwards.
            title: template.title,
            assigneeId: template.assigneeId,
            categoryId: template.categoryId,
          },
        });
        created += 1;
      } catch (error) {
        // A concurrent generate (cron and a page load racing) may have won.
        // The unique constraint is the guarantee; losing the race is fine.
        if (isUniqueViolation(error)) {
          skipped += 1;
          continue;
        }
        throw error;
      }
    }
  }

  return { created, skipped, templatesConsidered: templates.length };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

/**
 * Regenerate future instances after a template edit.
 *
 * Editing a template changes future instances only. PENDING instances dated
 * after today are dropped and rebuilt from the new schedule and the new
 * snapshot fields; anything due today or earlier, and anything already
 * completed or missed, is left exactly as it is.
 */
export async function regenerateFutureInstances(
  db: DbClient,
  templateId: string,
  today: DateOnly,
  horizonDays: number,
): Promise<GenerateResult & { removed: number }> {
  const { count: removed } = await db.taskInstance.deleteMany({
    where: {
      templateId,
      status: InstanceStatus.PENDING,
      dueDate: { gt: toDbDate(today) },
    },
  });

  const result = await generateInstances(db, addDays(today, 1), addDays(today, horizonDays), {
    templateIds: [templateId],
  });

  return { ...result, removed };
}

/**
 * Drop future pending instances without regenerating — used when a template is
 * deactivated. All history is left intact; templates are never hard-deleted.
 */
export async function removeFutureInstances(
  db: DbClient,
  templateId: string,
  today: DateOnly,
): Promise<number> {
  const { count } = await db.taskInstance.deleteMany({
    where: {
      templateId,
      status: InstanceStatus.PENDING,
      dueDate: { gt: toDbDate(today) },
    },
  });
  return count;
}

/**
 * The nightly sweep: harden PENDING instances to MISSED once the grace window
 * has closed. Idempotent — a second run changes no rows.
 */
export async function sweepMissed(
  db: DbClient,
  today: DateOnly,
  graceDays: number,
  options: { organisationId?: string } = {},
): Promise<{ missed: number }> {
  const cutoff = addDays(today, -graceDays);

  const stale = await db.taskInstance.findMany({
    where: {
      status: InstanceStatus.PENDING,
      dueDate: { lt: toDbDate(cutoff) },
      ...(options.organisationId ? { organisationId: options.organisationId } : {}),
    },
    select: { id: true, organisationId: true },
  });

  if (stale.length === 0) return { missed: 0 };

  const ids = stale.map((i) => i.id);
  await db.taskInstance.updateMany({
    where: { id: { in: ids } },
    data: { status: InstanceStatus.MISSED },
  });
  // Every status change writes exactly one AuditLog row. Non-negotiable — the
  // reporting is only credible if it is auditable.
  await db.auditLog.createMany({
    data: stale.map((i) => ({
      organisationId: i.organisationId,
      instanceId: i.id,
      userId: null,
      fromStatus: InstanceStatus.PENDING,
      toStatus: InstanceStatus.MISSED,
      source: "SYSTEM" as const,
    })),
  });

  return { missed: stale.length };
}
