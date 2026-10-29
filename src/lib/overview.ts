/**
 * What an agent needs to answer "how are we doing" in one call.
 *
 * One request rather than six, because the question is always the same shape:
 * what is late, who is drifting, and what is waiting on a reply from me. Six
 * round trips to assemble that is six chances to assemble it differently each
 * time.
 *
 * Read-only. Nothing here changes anything, which is why it can be called
 * freely and often.
 */

import { InstanceStatus, Role, type PrismaClient } from "@prisma/client";
import { buildOrgReport, buildWindow, type ReportWindow } from "./reports";
import { threadsFor } from "./messages";
import { daysBetween, toDateOnly, toDbDate, todayInLondon, type DateOnly } from "./time";

export type OverdueTask = {
  instanceId: string;
  title: string;
  assigneeName: string;
  dueDate: DateOnly;
  daysLate: number;
};

export type WaitingThread = {
  id: string;
  kind: "task" | "day-check";
  title: string;
  assigneeName: string;
  /** The last thing said, which is what a reply would be replying to. */
  lastMessage: string;
  lastFrom: string;
  lastAt: Date;
  unread: number;
};

export type Overview = {
  today: DateOnly;
  window: ReportWindow;
  totals: {
    assigned: number;
    completed: number;
    missed: number;
    outstanding: number;
    completionRate: number | null;
    onTimeRate: number | null;
  };
  people: { name: string; assigned: number; completed: number; missed: number; completionRate: number | null }[];
  /** Still open and past its due date — the things somebody can still act on. */
  overdue: OverdueTask[];
  /** Worst offenders by count over the window. */
  mostMissed: { title: string; assigneeName: string; count: number; assigned: number }[];
  /** Conversations with something unanswered in them. */
  waiting: WaitingThread[];
};

export async function buildOverview(
  db: PrismaClient,
  viewer: { id: string; organisationId: string; role: Role },
  options: { days?: number; today?: DateOnly } = {},
): Promise<Overview> {
  const today = options.today ?? todayInLondon();
  const window = buildWindow({ days: options.days ?? 7 }, today);

  const [report, overdueRows, threads] = await Promise.all([
    buildOrgReport(db, viewer.organisationId, window),
    db.taskInstance.findMany({
      where: {
        organisationId: viewer.organisationId,
        status: InstanceStatus.PENDING,
        dueDate: { lt: toDbDate(today) },
      },
      orderBy: [{ dueDate: "asc" }, { title: "asc" }],
      take: 100,
      select: {
        id: true,
        title: true,
        dueDate: true,
        assignee: { select: { name: true } },
      },
    }),
    threadsFor(db, viewer, "all"),
  ]);

  return {
    today,
    window,
    totals: {
      assigned: report.totals.assigned,
      completed: report.totals.completed,
      missed: report.totals.missed,
      outstanding: report.totals.outstanding,
      completionRate: report.totals.completionRate,
      onTimeRate: report.totals.onTimeRate,
    },
    people: report.leaderboard.map((row) => ({
      name: row.name,
      assigned: row.assigned,
      completed: row.completed,
      missed: row.missed,
      completionRate: row.completionRate,
    })),
    overdue: overdueRows.map((row) => {
      const due = toDateOnly(row.dueDate);
      return {
        instanceId: row.id,
        title: row.title,
        assigneeName: row.assignee.name,
        dueDate: due,
        daysLate: daysBetween(due, today),
      };
    }),
    mostMissed: report.rankings.missed.slice(0, 5).map((row) => ({
      title: row.title,
      assigneeName: row.assigneeName,
      count: row.count,
      assigned: row.assigned,
    })),
    // Somebody else spoke last, and nobody has answered. That is the whole
    // definition of "waiting on us" and it is the only list worth reading
    // every morning.
    waiting: threads
      .filter((thread) => {
        const last = thread.comments[thread.comments.length - 1];
        return last !== undefined && !last.mine;
      })
      .slice(0, 25)
      .map((thread) => {
        const last = thread.comments[thread.comments.length - 1];
        return {
          id: thread.id,
          kind: thread.kind,
          title: thread.title,
          assigneeName: thread.assigneeName,
          lastMessage: last.body,
          lastFrom: last.authorName,
          lastAt: last.createdAt,
          unread: thread.unread,
        };
      }),
  };
}
