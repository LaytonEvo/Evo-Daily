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
import { toDbDate, todayInLondon, type DateOnly } from "./time";

export type JobDefinition = {
  name: string;
  module: string;
  schedule: string;
  goodRun: string;
  warningIf: string;
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

function nudge(name: NudgeJob, schedule: string, goodRun: string): JobDefinition {
  return {
    name: `nudge.${name}`,
    module: "tasks",
    schedule,
    goodRun,
    warningIf: "Any Slack message failed to send",
    run: async (db) => nudgeOutcome(await runNudge(name, db)),
  };
}

export const JOBS: JobDefinition[] = [
  {
    name: "tasks.generate",
    module: "tasks",
    schedule: "Daily 00:05 UTC",
    goodRun: "Instances created across the horizon for every active template",
    warningIf: "An active template due today has no task for today",
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
    run: async (db) => {
      const result = await runSweepJob(db);
      // A Slack outage must not fail the sweep, so alerts come after it.
      const alerts = await missAlerts(db);
      const missed = result.results.reduce((n, r) => n + r.missed, 0);
      return {
        warning: alerts.failed > 0 ? `${alerts.failed} miss alert(s) failed to send` : undefined,
        message: `${missed} task(s) marked missed`,
        details: { today: result.today, missed, alertsSent: alerts.sent, alertsSkipped: alerts.skipped ?? null },
      };
    },
  },
  nudge("morning-brief", "Weekdays 11:00 UTC", "Each person with tasks today gets their brief"),
  nudge("afternoon-nudge", "Weekdays 15:00 UTC", "Each person with open tasks gets a nudge"),
  nudge("manager-digest", "Mondays 07:00 UTC", "The weekly digest posts to the manager channel"),
  nudge("miss-alerts", "Mondays 07:00 UTC", "Managers hear about runs of misses"),
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
