/**
 * The four nudges. Each is a pure "build the messages, then send them" pair,
 * so the message text can be tested without touching Slack.
 */

import { InstanceStatus, type PrismaClient } from "@prisma/client";
import { buildOrgReport, buildWindow } from "./reports";
import { escape, appUrl, link, managerChannelId, postMessage, slackEnabled, type Block } from "./slack";
import { briefBlocks } from "./slack-blocks";
import { formatRate } from "./utils";
import {
  addDays,
  formatDateOnly,
  formatTimeLondon,
  toDbDate,
  todayInLondon,
  type DateOnly,
} from "./time";

export type NudgeOutcome = {
  job: string;
  skipped?: string;
  sent: number;
  failed: number;
  messages?: Message[];
};

type Message = { to: string; text: string; blocks?: Block[] };

type Options = {
  today?: DateOnly;
  /** Build the messages without sending them — used by the tests. */
  dryRun?: boolean;
};

async function deliver(
  job: string,
  messages: Message[],
  dryRun: boolean,
): Promise<NudgeOutcome> {
  if (dryRun) return { job, sent: 0, failed: 0, messages };

  let sent = 0;
  let failed = 0;
  for (const message of messages) {
    const result = await postMessage(message.to, message.text, message.blocks);
    if (result.ok) sent += 1;
    else failed += 1;
  }
  return { job, sent, failed };
}

/** 08:30 weekdays — DM each active member their list for the day. */
export async function morningBrief(
  db: PrismaClient,
  options: Options = {},
): Promise<NudgeOutcome> {
  if (!slackEnabled() && !options.dryRun) {
    return { job: "morning-brief", skipped: "slack_not_configured", sent: 0, failed: 0 };
  }

  const today = options.today ?? todayInLondon();
  const users = await db.user.findMany({
    where: { isActive: true, slackUserId: { not: null } },
    select: { id: true, name: true, slackUserId: true },
  });

  const messages: Message[] = [];

  for (const user of users) {
    const tasks = await db.taskInstance.findMany({
      where: {
        assigneeId: user.id,
        status: InstanceStatus.PENDING,
        dueDate: { lte: toDbDate(today) },
      },
      orderBy: [{ dueDate: "asc" }, { dueAt: "asc" }],
      select: { id: true, title: true, dueDate: true, dueAt: true },
    });

    if (tasks.length === 0) continue;

    const lines = tasks.map((task) => {
      const overdue = task.dueDate < toDbDate(today);
      const time = task.dueAt && formatTimeLondon(task.dueAt) !== "23:59"
        ? ` (by ${formatTimeLondon(task.dueAt)})`
        : "";
      const late = overdue ? ` — *overdue from ${formatDateOnly(task.dueDate)}*` : "";
      return `• ${escape(task.title)}${time}${late}`;
    });

    const heading = `*${escape(user.name.split(" ")[0])} — ${tasks.length} task${tasks.length === 1 ? "" : "s"} today*`;

    messages.push({
      to: user.slackUserId!,
      // The text is the notification and the fallback; the blocks carry the
      // per-task Done buttons.
      text: [heading, ...lines, link(appUrl("/my-day"), "Open EvoTasks")].join("\n"),
      blocks: briefBlocks(
        heading,
        tasks.map((task) => ({
          id: task.id,
          title: task.title,
          dueAt: task.dueAt,
          overdue: task.dueDate < toDbDate(today),
          overdueFrom: formatDateOnly(task.dueDate),
        })),
      ),
    });
  }

  return deliver("morning-brief", messages, options.dryRun ?? false);
}

/** 16:00 weekdays — DM only those with something still open. */
export async function afternoonNudge(
  db: PrismaClient,
  options: Options = {},
): Promise<NudgeOutcome> {
  if (!slackEnabled() && !options.dryRun) {
    return { job: "afternoon-nudge", skipped: "slack_not_configured", sent: 0, failed: 0 };
  }

  const today = options.today ?? todayInLondon();
  const open = await db.taskInstance.groupBy({
    by: ["assigneeId"],
    where: {
      status: InstanceStatus.PENDING,
      dueDate: { lte: toDbDate(today) },
    },
    _count: { _all: true },
  });

  const users = await db.user.findMany({
    where: {
      id: { in: open.map((row) => row.assigneeId) },
      isActive: true,
      slackUserId: { not: null },
    },
    select: { id: true, slackUserId: true },
  });
  const slackIds = new Map(users.map((u) => [u.id, u.slackUserId!]));

  const messages = open
    .filter((row) => slackIds.has(row.assigneeId))
    .map((row) => {
      const count = row._count._all;
      return {
        to: slackIds.get(row.assigneeId)!,
        text: `${count} task${count === 1 ? "" : "s"} still open today. ${link(appUrl("/my-day"), "Clear them")}`,
      };
    });

  return deliver("afternoon-nudge", messages, options.dryRun ?? false);
}

/** Monday 08:00 — last week's numbers into the management channel. */
export async function managerDigest(
  db: PrismaClient,
  options: Options = {},
): Promise<NudgeOutcome> {
  const channel = managerChannelId();
  if ((!slackEnabled() || !channel) && !options.dryRun) {
    return { job: "manager-digest", skipped: "slack_not_configured", sent: 0, failed: 0 };
  }

  const today = options.today ?? todayInLondon();
  // Last week: the seven days ending yesterday.
  const window = buildWindow({ from: addDays(today, -7), to: addDays(today, -1) }, today);

  const organisations = await db.organisation.findMany({ select: { id: true, name: true } });
  const messages: { to: string; text: string }[] = [];

  for (const org of organisations) {
    const report = await buildOrgReport(db, org.id, window);
    if (report.totals.assigned === 0) continue;

    const leaderboard = report.leaderboard
      .slice(0, 8)
      .map(
        (row, index) =>
          `${index + 1}. ${escape(row.name)} — ${formatRate(row.completionRate)} (${row.completed}/${row.assigned})${row.lowVolume ? " _low volume_" : ""}`,
      );

    const problems = report.problemTasks
      .slice(0, 3)
      .map(
        (task) =>
          `• ${escape(task.title)} — ${formatRate(task.completionRate)} (${escape(task.assigneeName)})`,
      );

    messages.push({
      to: channel ?? "#management",
      text: [
        `*${escape(org.name)} — week to ${formatDateOnly(window.to)}*`,
        `Completion ${formatRate(report.totals.completionRate)} · on time ${formatRate(report.totals.onTimeRate)} · ${report.totals.missed} missed`,
        "",
        "*Leaderboard*",
        ...leaderboard,
        ...(problems.length > 0 ? ["", "*Problem tasks*", ...problems] : []),
        "",
        link(appUrl("/admin/reports?days=7"), "Full report"),
      ].join("\n"),
    });
  }

  return deliver("manager-digest", messages, options.dryRun ?? false);
}

/** On sweep — DM a manager when someone hits 3 misses in a rolling 7 days. */
export const MISS_ALERT_THRESHOLD = 3;
export const MISS_ALERT_WINDOW_DAYS = 7;

export async function missAlerts(
  db: PrismaClient,
  options: Options = {},
): Promise<NudgeOutcome> {
  if (!slackEnabled() && !options.dryRun) {
    return { job: "miss-alerts", skipped: "slack_not_configured", sent: 0, failed: 0 };
  }

  const today = options.today ?? todayInLondon();
  const from = addDays(today, -(MISS_ALERT_WINDOW_DAYS - 1));

  const misses = await db.taskInstance.groupBy({
    by: ["assigneeId"],
    where: {
      status: InstanceStatus.MISSED,
      dueDate: { gte: toDbDate(from), lte: toDbDate(today) },
    },
    _count: { _all: true },
  });

  const breaching = misses.filter((row) => row._count._all >= MISS_ALERT_THRESHOLD);
  if (breaching.length === 0) {
    return { job: "miss-alerts", sent: 0, failed: 0, ...(options.dryRun ? { messages: [] } : {}) };
  }

  const users = await db.user.findMany({
    where: { id: { in: breaching.map((row) => row.assigneeId) } },
    select: {
      id: true,
      name: true,
      manager: { select: { slackUserId: true, isActive: true } },
    },
  });
  const byId = new Map(users.map((u) => [u.id, u]));

  const messages: { to: string; text: string }[] = [];
  for (const row of breaching) {
    const user = byId.get(row.assigneeId);
    const managerSlackId = user?.manager?.slackUserId;
    // No manager, or a manager without Slack, means nobody to tell. The
    // leaderboard still carries it.
    if (!user || !managerSlackId || !user.manager?.isActive) continue;

    messages.push({
      to: managerSlackId,
      text: `${escape(user.name)} has missed ${row._count._all} tasks in the last ${MISS_ALERT_WINDOW_DAYS} days. ${link(appUrl(`/admin/reports/${user.id}?days=7`), "See what")}`,
    });
  }

  return deliver("miss-alerts", messages, options.dryRun ?? false);
}
