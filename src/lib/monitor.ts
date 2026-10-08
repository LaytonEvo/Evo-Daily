/**
 * The hub's monitoring pass, every 15 minutes.
 *
 * It answers three questions for every job — did it run, did it succeed, did
 * it produce what it should — and acts only when a person needs to:
 *
 *   job missed its window       → incident (one Slack alert to admins)
 *   job failed twice in a row   → incident + a task for the hub owner
 *   warning three runs running  → a task for the hub owner (digest lists it)
 *   integration down            → incident
 *   token expiring within 7 days→ a task for the hub owner
 *
 * Failing once is left to the automatic retry and the activity log.
 */

import { IntegrationStatus, JobRunStatus, type PrismaClient } from "@prisma/client";
import { expireApprovals } from "./approvals";
import { createTask } from "./create-task";
import { hubOwnerId } from "./hub-settings";
import { openIncident, resolveIncident } from "./incidents";
import { todayInLondon } from "./time";

export type MonitoredJob = { name: string; expectedEveryHours: number | null };

const HOUR = 60 * 60 * 1000;

export async function runMonitor(db: PrismaClient, jobs: MonitoredJob[], now = new Date()) {
  const findings: string[] = [];
  const owner = await hubOwnerId(db);
  const today = todayInLondon(now);

  const ownerTask = async (title: string, description: string, ref: string) => {
    if (!owner) return;
    const { created } = await createTask(
      db,
      { title, description, assigneeId: owner, due: today, sourceModule: "hub", sourceRef: ref },
      today,
    );
    if (created) findings.push(`task: ${title}`);
  };

  const expired = await expireApprovals(db, now);
  if (expired) findings.push(`${expired} approval(s) expired`);

  // When the log began. A job can't have missed a window that opened before
  // there was a log to see it in.
  const first = await db.jobRun.findFirst({ orderBy: { startedAt: "asc" }, select: { startedAt: true } });

  for (const job of jobs) {
    const recent = await db.jobRun.findMany({
      where: { jobName: job.name, status: { not: JobRunStatus.RUNNING } },
      orderBy: { startedAt: "desc" },
      take: 3,
    });

    if (job.expectedEveryHours && first) {
      const windowMs = job.expectedEveryHours * HOUR;
      const lastSeen = recent[0]?.startedAt ?? first.startedAt;
      const key = `job-missed:${job.name}`;
      if (now.getTime() - lastSeen.getTime() > windowMs) {
        const r = await openIncident(db, {
          key,
          title: `${job.name} missed its window`,
          detail: `Expected at least every ${job.expectedEveryHours} h; last ran ${recent[0] ? recent[0].startedAt.toISOString() : "never since the log started"}.`,
        });
        if (r.opened) findings.push(`missed: ${job.name}`);
      } else {
        await resolveIncident(db, key);
      }
    }

    const key = `job-failing:${job.name}`;
    if (recent.length >= 2 && recent[0].status === JobRunStatus.FAILED && recent[1].status === JobRunStatus.FAILED) {
      const r = await openIncident(db, {
        key,
        title: `${job.name} failed twice in a row`,
        detail: recent[0].message ?? undefined,
      });
      if (r.opened) findings.push(`failing: ${job.name}`);
      await ownerTask(
        `Fix failing job: ${job.name}`,
        `It has failed on its last two runs. Latest error: ${recent[0].message ?? "unknown"}. Use "Copy for Claude Code" on the Activity page.`,
        `/admin/health#${key}`,
      );
    } else if (recent[0]?.status === JobRunStatus.SUCCESS || recent[0]?.status === JobRunStatus.WARNING) {
      await resolveIncident(db, key);
    }

    if (recent.length === 3 && recent.every((r) => r.status === JobRunStatus.WARNING)) {
      await ownerTask(
        `Look into repeated warnings: ${job.name}`,
        `Its last three runs ran but warned. Latest: ${recent[0].message ?? "—"}.`,
        `/admin/health#job-warning:${job.name}`,
      );
    }
  }

  const integrations = await db.integration.findMany();
  for (const integration of integrations) {
    const key = `integration:${integration.name}`;
    if (integration.status === IntegrationStatus.DOWN) {
      const r = await openIncident(db, {
        key,
        title: `${integration.name} is down`,
        detail: integration.lastError ?? undefined,
      });
      if (r.opened) findings.push(`down: ${integration.name}`);
    } else if (integration.status === IntegrationStatus.OK) {
      await resolveIncident(db, key);
    }

    if (integration.tokenExpiresAt && integration.tokenExpiresAt.getTime() - now.getTime() < 7 * 24 * HOUR) {
      await ownerTask(
        `Renew the ${integration.name} connection`,
        `Its token expires ${integration.tokenExpiresAt.toISOString().slice(0, 10)}.`,
        `/admin/health#token:${integration.name}`,
      );
    }
  }

  return { findings };
}

/** Old history goes: logs after 12 months, decided approvals after 24. */
export async function housekeeping(db: PrismaClient, now = new Date()) {
  const months = (n: number) => new Date(now.getFullYear(), now.getMonth() - n, now.getDate());
  const [runs, errors, incidents, approvals] = await Promise.all([
    db.jobRun.deleteMany({ where: { startedAt: { lt: months(12) } } }),
    db.appError.deleteMany({ where: { at: { lt: months(12) } } }),
    db.incident.deleteMany({ where: { openKey: null, resolvedAt: { lt: months(12) } } }),
    db.approval.deleteMany({ where: { status: { not: "PENDING" }, updatedAt: { lt: months(24) } } }),
  ]);
  return { runs: runs.count, errors: errors.count, incidents: incidents.count, approvals: approvals.count };
}
