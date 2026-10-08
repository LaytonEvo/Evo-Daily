/**
 * Every background job, with its schedule and what a good run looks like.
 *
 * A job is listed here before it goes live. The cron endpoints and the admin
 * "Run now" button both go through runRegisteredJob, so every run — scheduled
 * or by hand — lands in the activity log the same way.
 *
 * Schedules are UTC because Railway cron has no timezone; see cron.sh.
 */

import type { PrismaClient } from "@prisma/client";
import { runGenerateJob, runSweepJob } from "./jobs";
import { runJob, type JobOutcome, type JobTrigger } from "./job-runs";
import { runNudge, type NudgeJob } from "./nudge-jobs";
import { missAlerts, type NudgeOutcome } from "./nudges";
import { dueDatesFor } from "./recurrence";
import { timeNowInLondon, toDbDate, todayInLondon, type DateOnly } from "./time";
import { automationEnabled } from "./hub-settings";
import { housekeeping, runMonitor } from "./monitor";
import { sendAdminDigest } from "./hub-digest";
import { JobRunStatus } from "@prisma/client";

export type JobDefinition = {
  name: string;
  module: string;
  schedule: string;
  goodRun: string;
  warningIf: string;
  /** Flag a missed window if it hasn't run for this long. Null: not checked. */
  expectedEveryHours: number | null;
  run: (db: PrismaClient) => Promise<JobOutcome>;
};

/** Active templates due today that have no instance for today. */
export async function templatesMissingToday(db: PrismaClient, today: DateOnly = todayInLondon()) {
  const templates = await db.taskTemplate.findMany({
    where: { isActive: true, startDate: { lte: toDbDate(today) } },
    select: {
      id: true,
      title: true,
      frequency: true,
      daysOfWeek: true,
      dayOfWeek: true,
      dayOfMonth: true,
      startDate: true,
      endDate: true,
      instances: { where: { dueDate: toDbDate(today) }, select: { id: true } },
    },
  });
  return templates
    .filter((t) => dueDatesFor(t, today, today).length > 0 && t.instances.length === 0)
    .map((t) => ({ id: t.id, title: t.title }));
}

function nudgeOutcome(result: NudgeOutcome): JobOutcome {
  return {
    warning: result.failed > 0 ? `${result.failed} message(s) failed to send` : undefined,
    message: result.skipped ?? `${result.sent} message(s) sent`,
    // Not the messages themselves: they name people and their tasks.
    details: { sent: result.sent, failed: result.failed, skipped: result.skipped ?? null },
  };
}

const PAUSED: JobOutcome = { message: "Skipped: automation for Tasks is paused" };

function nudge(name: NudgeJob, schedule: string, goodRun: string, expectedEveryHours: number): JobDefinition {
  return {
    name: `nudge.${name}`,
    module: "tasks",
    schedule,
    goodRun,
    warningIf: "Any Slack message failed to send",
    expectedEveryHours,
    run: async (db) => ((await automationEnabled(db, "tasks")) ? nudgeOutcome(await runNudge(name, db)) : PAUSED),
  };
}

/** Whether a once-a-day job has already succeeded today, London time. */
async function ranToday(db: PrismaClient, name: string) {
  const last = await db.jobRun.findFirst({
    where: { jobName: name, status: { in: [JobRunStatus.SUCCESS, JobRunStatus.WARNING] } },
    orderBy: { startedAt: "desc" },
  });
  return last ? todayInLondon(last.startedAt) === todayInLondon() : false;
}

export const JOBS: JobDefinition[] = [
  {
    name: "tasks.generate",
    module: "tasks",
    schedule: "Daily 00:05 UTC",
    goodRun: "Instances created across the horizon for every active template",
    warningIf: "An active template due today has no task for today",
    expectedEveryHours: 26,
    run: async (db) => {
      const result = await runGenerateJob(db);
      const created = result.results.reduce((n, r) => n + r.created, 0);
      const missing = await templatesMissingToday(db, result.today);
      return {
        warning: missing.length ? `${missing.length} task(s) due today were not generated` : undefined,
        message: `${created} instance(s) created`,
        details: { today: result.today, created, missing, results: result.results },
      };
    },
  },
  {
    name: "tasks.sweep",
    module: "tasks",
    schedule: "Daily 00:15 UTC",
    goodRun: "Tasks past their grace period marked missed; miss alerts sent",
    warningIf: "Any miss alert failed to send",
    expectedEveryHours: 26,
    run: async (db) => {
      const result = await runSweepJob(db);
      // A Slack outage must not fail the sweep, so alerts come after it.
      const alerts = (await automationEnabled(db, "tasks"))
        ? await missAlerts(db)
        : { sent: 0, failed: 0, skipped: "automation paused" };
      const missed = result.results.reduce((n, r) => n + r.missed, 0);
      return {
        warning: alerts.failed > 0 ? `${alerts.failed} miss alert(s) failed to send` : undefined,
        message: `${missed} task(s) marked missed`,
        details: { today: result.today, missed, alertsSent: alerts.sent, alertsSkipped: alerts.skipped ?? null },
      };
    },
  },
  // Weekday jobs allow for the weekend; weekly ones for the week.
  nudge("morning-brief", "Weekdays 11:00 UTC", "Each person with tasks or approvals today gets their brief", 74),
  nudge("afternoon-nudge", "Weekdays 15:00 UTC", "Each person with open tasks gets a nudge", 74),
  nudge("manager-digest", "Mondays 07:00 UTC", "The weekly digest posts to the manager channel", 170),
  nudge("miss-alerts", "Mondays 07:00 UTC", "Managers hear about runs of misses", 170),
  {
    name: "hub.monitor",
    module: "hub",
    schedule: "Every 15 minutes",
    goodRun: "Every job checked for missed windows and repeat failures; integrations checked",
    warningIf: "Never: findings are alerts and tasks, not warnings",
    // It can't notice its own absence. The external uptime monitor and the
    // missed-window check on the daily digest cover that.
    expectedEveryHours: null,
    run: async (db) => {
      const { findings } = await runMonitor(
        db,
        JOBS.map((j) => ({ name: j.name, expectedEveryHours: j.expectedEveryHours })),
      );
      // The two daily hub jobs ride on this one rather than needing cron
      // services of their own: housekeeping once a day, the digest from 07:30.
      if (!(await ranToday(db, "hub.housekeeping"))) {
        await runRegisteredJob(db, "hub.housekeeping", "schedule").catch(() => {});
      }
      if (timeNowInLondon() >= "07:30" && !(await ranToday(db, "hub.admin-digest"))) {
        await runRegisteredJob(db, "hub.admin-digest", "schedule").catch(() => {});
      }
      return { message: findings.length ? findings.join("; ") : "Nothing needs anyone", details: { findings } };
    },
  },
  {
    name: "hub.admin-digest",
    module: "hub",
    schedule: "Daily 07:30 London (via hub.monitor)",
    goodRun: "Admins get one health summary",
    warningIf: "Nobody could be messaged",
    expectedEveryHours: 26,
    run: async (db) => {
      const { sent, issues } = await sendAdminDigest(db);
      return {
        warning: sent === 0 ? "No admin could be messaged: check Slack and admins' Slack IDs" : undefined,
        message: `${issues} item(s) reported to ${sent} admin(s)`,
      };
    },
  },
  {
    name: "hub.housekeeping",
    module: "hub",
    schedule: "Daily (via hub.monitor)",
    goodRun: "Logs over 12 months and approvals over 24 months removed",
    warningIf: "Never",
    expectedEveryHours: 26,
    run: async (db) => {
      const removed = await housekeeping(db);
      return { message: "Old history removed", details: removed };
    },
  },
];

export function getJob(name: string): JobDefinition | undefined {
  return JOBS.find((job) => job.name === name);
}

/** Run a registered job and record it in the activity log. */
export function runRegisteredJob(db: PrismaClient, name: string, trigger: JobTrigger) {
  const job = getJob(name);
  if (!job) throw new Error(`Unknown job: ${name}`);
  return runJob(db, { module: job.module, name: job.name, trigger }, () => job.run(db));
}
