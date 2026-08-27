/**
 * Reporting.
 *
 * The metric definitions here are the contract. They are implemented once, in
 * one place, and every panel and every CSV reads from them — so the leaderboard
 * can never disagree with the org summary, and an export can never disagree
 * with the screen above it.
 *
 *   assigned       = instances whose dueDate falls in the window
 *   completed      = status COMPLETED
 *   missed         = status MISSED
 *   outstanding    = status PENDING (still inside the grace window)
 *   completionRate = completed / assigned
 *   onTime         = COMPLETED and not wasLate
 *   onTimeRate     = onTime / completed, null when completed = 0
 *
 * Attribution reads the instance snapshot fields only. It never joins through
 * to the template: if a task moved from Alex to Brad in October, September's
 * report still shows it against Alex.
 *
 * Nobody is penalised for work that is not due yet, so the window is always
 * clipped to today before anything is counted.
 */

import { InstanceStatus, type PrismaClient } from "@prisma/client";
import { describeSchedule } from "./recurrence";
import { rate } from "./utils";
import {
  addDays,
  compareDateOnly,
  daysBetween,
  minDateOnly,
  toDateOnly,
  toDbDate,
  todayInLondon,
  type DateOnly,
} from "./time";

/** Anyone below this many assigned instances is flagged, not ranked on merit. */
export const LOW_VOLUME_THRESHOLD = 10;
/** A template needs this many instances before its rate means anything. */
export const PROBLEM_TASK_MIN_INSTANCES = 5;

export type ReportWindow = {
  from: DateOnly;
  /** Clipped to today: future instances appear in no denominator anywhere. */
  to: DateOnly;
  /** What the user asked for, before clipping — for the window label. */
  requestedTo: DateOnly;
  days: number;
  label: string;
};

export type Totals = {
  assigned: number;
  completed: number;
  missed: number;
  outstanding: number;
  onTime: number;
  completionRate: number | null;
  onTimeRate: number | null;
};

export type LeaderboardRow = Totals & {
  userId: string;
  name: string;
  isActive: boolean;
  /** True below LOW_VOLUME_THRESHOLD — a 3-for-3 must not top the table. */
  lowVolume: boolean;
};

export type TrendPoint = {
  date: DateOnly;
  assigned: number;
  completed: number;
  completionRate: number | null;
  /** Trailing 7-day average of completionRate, null until enough data. */
  movingAverage: number | null;
};

export type ProblemTask = Totals & {
  templateId: string;
  title: string;
  assigneeName: string;
  categoryName: string | null;
  schedule: string;
  isActive: boolean;
};

export type CategoryRow = Totals & {
  categoryId: string | null;
  name: string;
  colour: string | null;
};

export type OrgReport = {
  window: ReportWindow;
  previousWindow: ReportWindow;
  totals: Totals;
  previousTotals: Totals;
  deltas: {
    completionRate: number | null;
    onTimeRate: number | null;
    completed: number;
    missed: number;
  };
  leaderboard: LeaderboardRow[];
  trend: TrendPoint[];
  problemTasks: ProblemTask[];
  categories: CategoryRow[];
};

/**
 * Build the window. The default is a rolling 30 days ending today; a custom
 * range is honoured but still clipped to today at the far end.
 */
export function buildWindow(
  input: { days?: number; from?: string; to?: string } = {},
  today: DateOnly = todayInLondon(),
): ReportWindow {
  if (input.from && input.to) {
    const from = toDateOnly(input.from);
    const requestedTo = toDateOnly(input.to);
    const to = minDateOnly(requestedTo, today);
    return {
      from,
      to,
      requestedTo,
      days: Math.max(1, daysBetween(from, to) + 1),
      label: "Custom range",
    };
  }

  const days = input.days && input.days > 0 ? Math.min(input.days, 730) : 30;
  return {
    from: addDays(today, -(days - 1)),
    to: today,
    requestedTo: today,
    days,
    label: `Last ${days} days`,
  };
}

/** The equally-sized window immediately before this one, for the deltas. */
export function previousWindow(window: ReportWindow): ReportWindow {
  const to = addDays(window.from, -1);
  const from = addDays(to, -(window.days - 1));
  return { from, to, requestedTo: to, days: window.days, label: "Previous period" };
}

type InstanceRow = {
  id: string;
  dueDate: Date;
  status: InstanceStatus;
  wasLate: boolean;
  title: string;
  assigneeId: string;
  categoryId: string | null;
  templateId: string;
};

async function loadInstances(
  db: PrismaClient,
  organisationId: string,
  window: ReportWindow,
  filters: { assigneeId?: string; categoryId?: string } = {},
): Promise<InstanceRow[]> {
  // An inverted window (a custom range that starts in the future) has no rows.
  if (compareDateOnly(window.from, window.to) > 0) return [];

  return db.taskInstance.findMany({
    where: {
      organisationId,
      dueDate: { gte: toDbDate(window.from), lte: toDbDate(window.to) },
      ...(filters.assigneeId ? { assigneeId: filters.assigneeId } : {}),
      ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    },
    select: {
      id: true,
      dueDate: true,
      status: true,
      wasLate: true,
      title: true,
      assigneeId: true,
      categoryId: true,
      templateId: true,
    },
  });
}

export function totalsOf(instances: Pick<InstanceRow, "status" | "wasLate">[]): Totals {
  let completed = 0;
  let missed = 0;
  let outstanding = 0;
  let onTime = 0;

  for (const instance of instances) {
    if (instance.status === InstanceStatus.COMPLETED) {
      completed += 1;
      if (!instance.wasLate) onTime += 1;
    } else if (instance.status === InstanceStatus.MISSED) {
      missed += 1;
    } else {
      outstanding += 1;
    }
  }

  const assigned = instances.length;
  return {
    assigned,
    completed,
    missed,
    outstanding,
    onTime,
    completionRate: rate(completed, assigned),
    onTimeRate: rate(onTime, completed),
  };
}

function groupBy<T, K extends string | null>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = map.get(k);
    if (bucket) bucket.push(item);
    else map.set(k, [item]);
  }
  return map;
}

export async function buildOrgReport(
  db: PrismaClient,
  organisationId: string,
  window: ReportWindow,
): Promise<OrgReport> {
  const previous = previousWindow(window);

  const [instances, previousInstances, users, categories, templates] = await Promise.all([
    loadInstances(db, organisationId, window),
    loadInstances(db, organisationId, previous),
    db.user.findMany({
      where: { organisationId },
      select: { id: true, name: true, isActive: true },
      orderBy: { name: "asc" },
    }),
    db.category.findMany({
      where: { organisationId },
      select: { id: true, name: true, colour: true },
      orderBy: { sortOrder: "asc" },
    }),
    db.taskTemplate.findMany({
      where: { organisationId },
      select: {
        id: true,
        title: true,
        isActive: true,
        frequency: true,
        daysOfWeek: true,
        dayOfWeek: true,
        dayOfMonth: true,
        startDate: true,
        endDate: true,
        categoryId: true,
        assignee: { select: { name: true } },
      },
    }),
  ]);

  const totals = totalsOf(instances);
  const previousTotals = totalsOf(previousInstances);

  const userNames = new Map(users.map((u) => [u.id, u]));
  const categoryById = new Map(categories.map((c) => [c.id, c]));

  // --- Leaderboard ---------------------------------------------------------
  const byUser = groupBy(instances, (i) => i.assigneeId);
  const leaderboard: LeaderboardRow[] = [...byUser.entries()]
    .map(([userId, rows]) => {
      const user = userNames.get(userId);
      return {
        userId,
        name: user?.name ?? "Removed user",
        isActive: user?.isActive ?? false,
        lowVolume: rows.length < LOW_VOLUME_THRESHOLD,
        ...totalsOf(rows),
      };
    })
    .sort(compareLeaderboardRows);

  // --- Trend ---------------------------------------------------------------
  const byDate = groupBy(instances, (i) => toDateOnly(i.dueDate));
  const trend: TrendPoint[] = [];
  for (
    let date = window.from;
    compareDateOnly(date, window.to) <= 0;
    date = addDays(date, 1)
  ) {
    const rows = byDate.get(date) ?? [];
    const dayTotals = totalsOf(rows);
    trend.push({
      date,
      assigned: dayTotals.assigned,
      completed: dayTotals.completed,
      completionRate: dayTotals.completionRate,
      movingAverage: null,
    });
  }
  applyMovingAverage(trend, 7);

  // --- Problem tasks -------------------------------------------------------
  const byTemplate = groupBy(instances, (i) => i.templateId);
  const templateById = new Map(templates.map((t) => [t.id, t]));
  const problemTasks: ProblemTask[] = [...byTemplate.entries()]
    .filter(([, rows]) => rows.length >= PROBLEM_TASK_MIN_INSTANCES)
    // A task at 100% is not a problem. Listing it under this heading buries
    // the ones that are.
    .filter(([, rows]) => totalsOf(rows).completed < rows.length)
    .map(([templateId, rows]) => {
      const template = templateById.get(templateId);
      return {
        templateId,
        // The instance snapshot is the honest title for the window.
        title: rows[0]?.title ?? template?.title ?? "Removed task",
        assigneeName: template?.assignee.name ?? "—",
        categoryName: template?.categoryId
          ? (categoryById.get(template.categoryId)?.name ?? null)
          : null,
        schedule: template ? describeSchedule(template) : "—",
        isActive: template?.isActive ?? false,
        ...totalsOf(rows),
      };
    })
    .sort((a, b) => (a.completionRate ?? 1) - (b.completionRate ?? 1) || b.assigned - a.assigned);

  // --- By category ---------------------------------------------------------
  const byCategory = groupBy(instances, (i) => i.categoryId);
  const categoryRows: CategoryRow[] = [...byCategory.entries()]
    .map(([categoryId, rows]) => {
      const category = categoryId ? categoryById.get(categoryId) : null;
      return {
        categoryId,
        name: category?.name ?? "Uncategorised",
        colour: category?.colour ?? null,
        ...totalsOf(rows),
      };
    })
    .sort((a, b) => (a.completionRate ?? 0) - (b.completionRate ?? 0));

  return {
    window,
    previousWindow: previous,
    totals,
    previousTotals,
    deltas: {
      completionRate: deltaOf(totals.completionRate, previousTotals.completionRate),
      onTimeRate: deltaOf(totals.onTimeRate, previousTotals.onTimeRate),
      completed: totals.completed - previousTotals.completed,
      missed: totals.missed - previousTotals.missed,
    },
    leaderboard,
    trend,
    problemTasks,
    categories: categoryRows,
  };
}

/**
 * Default ordering: completion rate descending, but low-volume people sink
 * below everyone who is actually carrying a load. A 3-for-3 must not sit above
 * someone at 92% across 80 tasks.
 */
function compareLeaderboardRows(a: LeaderboardRow, b: LeaderboardRow): number {
  if (a.lowVolume !== b.lowVolume) return a.lowVolume ? 1 : -1;
  return (b.completionRate ?? -1) - (a.completionRate ?? -1) || b.assigned - a.assigned;
}

function deltaOf(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  return current - previous;
}

function applyMovingAverage(points: TrendPoint[], span: number): void {
  for (let i = 0; i < points.length; i += 1) {
    const slice = points.slice(Math.max(0, i - span + 1), i + 1);
    // Average over the underlying counts, not over the daily rates — otherwise
    // a day with one task swings the line as hard as a day with forty.
    const assigned = slice.reduce((sum, p) => sum + p.assigned, 0);
    const completed = slice.reduce((sum, p) => sum + p.completed, 0);
    points[i].movingAverage = rate(completed, assigned);
  }
}

export type PersonReport = {
  user: { id: string; name: string; email: string; isActive: boolean };
  window: ReportWindow;
  totals: Totals;
  categories: CategoryRow[];
  missed: {
    id: string;
    title: string;
    dueDate: DateOnly;
    categoryName: string | null;
  }[];
  history: {
    id: string;
    title: string;
    dueDate: DateOnly;
    status: InstanceStatus;
    wasLate: boolean;
    completedAt: Date | null;
    note: string | null;
    categoryName: string | null;
  }[];
};

export async function buildPersonReport(
  db: PrismaClient,
  organisationId: string,
  userId: string,
  window: ReportWindow,
): Promise<PersonReport | null> {
  const user = await db.user.findFirst({
    where: { id: userId, organisationId },
    select: { id: true, name: true, email: true, isActive: true },
  });
  if (!user) return null;

  const rows = await db.taskInstance.findMany({
    where: {
      organisationId,
      assigneeId: userId,
      dueDate: { gte: toDbDate(window.from), lte: toDbDate(window.to) },
    },
    select: {
      id: true,
      title: true,
      dueDate: true,
      status: true,
      wasLate: true,
      completedAt: true,
      note: true,
      categoryId: true,
      assigneeId: true,
      templateId: true,
      category: { select: { name: true, colour: true } },
    },
    orderBy: [{ dueDate: "desc" }, { title: "asc" }],
  });

  const byCategory = groupBy(rows, (r) => r.categoryId);
  const categories: CategoryRow[] = [...byCategory.entries()]
    .map(([categoryId, group]) => ({
      categoryId,
      name: group[0]?.category?.name ?? "Uncategorised",
      colour: group[0]?.category?.colour ?? null,
      ...totalsOf(group),
    }))
    .sort((a, b) => (a.completionRate ?? 0) - (b.completionRate ?? 0));

  return {
    user,
    window,
    totals: totalsOf(rows),
    categories,
    missed: rows
      .filter((r) => r.status === InstanceStatus.MISSED)
      .map((r) => ({
        id: r.id,
        title: r.title,
        dueDate: toDateOnly(r.dueDate),
        categoryName: r.category?.name ?? null,
      })),
    history: rows.map((r) => ({
      id: r.id,
      title: r.title,
      dueDate: toDateOnly(r.dueDate),
      status: r.status,
      wasLate: r.wasLate,
      completedAt: r.completedAt,
      note: r.note,
      categoryName: r.category?.name ?? null,
    })),
  };
}

/**
 * Completion rate over the last N days for one template — shown inline on the
 * admin templates table so a badly-designed task is visible where it is edited.
 */
export async function templateCompletionRates(
  db: PrismaClient,
  organisationId: string,
  days = 30,
  today: DateOnly = todayInLondon(),
): Promise<Map<string, Totals>> {
  const window = buildWindow({ days }, today);
  const rows = await loadInstances(db, organisationId, window);
  const byTemplate = groupBy(rows, (r) => r.templateId);
  return new Map([...byTemplate.entries()].map(([id, group]) => [id, totalsOf(group)]));
}
