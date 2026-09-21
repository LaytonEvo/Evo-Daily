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
  eachDateInRange,
  formatDateOnly,
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
  /** Everything that was genuinely owed. Excludes excused days. */
  assigned: number;
  completed: number;
  missed: number;
  outstanding: number;
  onTime: number;
  /** Days that fell inside someone's uncovered time off. Reported, not counted. */
  excused: number;
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
  /** The same series per person, keyed by user id. Empty for anyone with no instances. */
  trendByUser: Record<string, TrendPoint[]>;
  problemTasks: ProblemTask[];
  categories: CategoryRow[];
};

/**
 * Build the window. The default is a rolling 30 days ending today; a custom
 * range is honoured but still clipped to today at the far end.
 */
/**
 * Name a window the way somebody would say it out loud.
 *
 * A single day reported as "Custom range" is technically true and useless —
 * the label is what the export is titled and what the screen says you are
 * looking at, and "Today" is the answer to the question that was asked.
 */
function labelFor(from: DateOnly, to: DateOnly, today: DateOnly): string {
  if (from !== to) return "Custom range";
  if (from === today) return "Today";
  if (from === addDays(today, -1)) return "Yesterday";
  return formatDateOnly(from, { withYear: true });
}

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
      label: labelFor(from, to, today),
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
  let excused = 0;

  for (const instance of instances) {
    if (instance.status === InstanceStatus.COMPLETED) {
      completed += 1;
      if (!instance.wasLate) onTime += 1;
    } else if (instance.status === InstanceStatus.MISSED) {
      missed += 1;
    } else if (instance.status === InstanceStatus.EXCUSED) {
      // Deliberately outside `assigned`: nobody was expected to do it, so it
      // belongs in neither half of a completion rate. Counting it as assigned
      // would make a fortnight off look like a fortnight of failure; counting
      // it as completed would be a lie.
      excused += 1;
    } else {
      outstanding += 1;
    }
  }

  const assigned = instances.length - excused;
  return {
    assigned,
    completed,
    missed,
    outstanding,
    onTime,
    excused,
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

/**
 * The daily completion series for one set of instances.
 *
 * Days with nothing due stay in with `assigned: 0` and a null rate: the chart
 * draws them as a gap rather than a dip, and dropping them would make a
 * weekend look like a bad day.
 */
export function buildTrend(
  instances: Pick<InstanceRow, "dueDate" | "status" | "wasLate">[],
  window: Pick<ReportWindow, "from" | "to">,
): TrendPoint[] {
  const byDate = groupBy(instances, (i) => toDateOnly(i.dueDate));
  const points: TrendPoint[] = [];

  for (let date = window.from; compareDateOnly(date, window.to) <= 0; date = addDays(date, 1)) {
    const rows = byDate.get(date) ?? [];
    const dayTotals = totalsOf(rows);
    points.push({
      date,
      assigned: dayTotals.assigned,
      completed: dayTotals.completed,
      completionRate: dayTotals.completionRate,
      movingAverage: null,
    });
  }

  applyMovingAverage(points, 7);
  return points;
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
  const trend = buildTrend(instances, window);

  // One series per person as well as the whole org. Computed here rather than
  // fetched on demand because the instances are already loaded and a window is
  // at most a few hundred rows — a round trip per person to re-slice data the
  // page is holding would be the expensive way round.
  const trendByUser: Record<string, TrendPoint[]> = {};
  for (const [userId, rows] of byUser.entries()) {
    trendByUser[userId] = buildTrend(rows, window);
  }

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
    trendByUser,
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
    commentCount: number;
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
      // Just the count: the thread itself is fetched when a row is opened.
      _count: { select: { comments: true } },
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
      commentCount: r._count.comments,
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

/** Seven days including the day itself — "the running week" on the chart. */
export const RUNNING_WEEK_DAYS = 7;

export type DayBreakdown = {
  date: DateOnly;
  completed: number;
  missed: number;
  /** Completed, but after the deadline. A subset of `completed`. */
  late: number;
  /** Genuinely owed that day. Excused days are reported nowhere in here. */
  assigned: number;
  /** This day and the six before it, so a single bad Monday is not a trend. */
  weekCompleted: number;
  weekMissed: number;
};

/**
 * One row per day in the window, including the days nothing was due.
 *
 * Empty days are kept rather than dropped: a chart that silently skips them
 * draws a fortnight of holiday as a continuous run of work, and the gap is
 * usually the thing worth seeing.
 *
 * The running-week totals count backwards from each day, including days before
 * the window — the caller passes every row it has, and the window only decides
 * which days are drawn. Without that the first six columns of any chart would
 * under-report, and they are the ones nearest the eye.
 */
export type DatedInstance = {
  dueDate: DateOnly | Date;
  status: InstanceStatus;
  wasLate: boolean;
};

export function dailyBreakdown(
  rows: DatedInstance[],
  window: Pick<ReportWindow, "from" | "to">,
): DayBreakdown[] {
  type Tally = { completed: number; missed: number; late: number; assigned: number };
  const byDay = new Map<DateOnly, Tally>();

  for (const row of rows) {
    const date = toDateOnly(row.dueDate);
    const day: Tally = byDay.get(date) ?? { completed: 0, missed: 0, late: 0, assigned: 0 };
    if (row.status !== InstanceStatus.EXCUSED) day.assigned += 1;
    if (row.status === InstanceStatus.COMPLETED) {
      day.completed += 1;
      if (row.wasLate) day.late += 1;
    }
    if (row.status === InstanceStatus.MISSED) day.missed += 1;
    byDay.set(date, day);
  }

  return eachDateInRange(window.from, window.to).map((date) => {
    const day = byDay.get(date) ?? { completed: 0, missed: 0, late: 0, assigned: 0 };

    let weekCompleted = 0;
    let weekMissed = 0;
    for (let back = 0; back < RUNNING_WEEK_DAYS; back += 1) {
      const earlier = byDay.get(addDays(date, -back));
      if (!earlier) continue;
      weekCompleted += earlier.completed;
      weekMissed += earlier.missed;
    }

    return { date, ...day, weekCompleted, weekMissed };
  });
}

/**
 * How a one-day window reads on screen.
 *
 * "Today · Mon 21 Sep 2026" says both things worth saying. For any other single
 * day the label already *is* the date, and printing it twice looks like a bug.
 */
export function singleDayLabel(window: Pick<ReportWindow, "from" | "label">): string {
  const date = formatDateOnly(window.from, { withYear: true });
  return window.label === date ? date : `${window.label} · ${date}`;
}
