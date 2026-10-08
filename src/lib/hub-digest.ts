/**
 * The admins' 07:30 health digest: what failed, what warned, what is open,
 * and which approvals have waited too long. One message a day, so outcome
 * warnings — things that ran but look off — are seen without paging anyone.
 */

import { ApprovalStatus, IntegrationStatus, JobRunStatus, type PrismaClient } from "@prisma/client";
import { STALE_AFTER_MS } from "./approvals";
import { notifyAdmins } from "./incidents";
import { appUrl, escape, link } from "./slack";

export async function buildAdminDigest(db: PrismaClient, now = new Date()) {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [runs, incidents, staleApprovals, pendingApprovals, integrations, errors] = await Promise.all([
    db.jobRun.findMany({
      where: { startedAt: { gte: since }, status: { in: [JobRunStatus.FAILED, JobRunStatus.WARNING] } },
      orderBy: { startedAt: "desc" },
    }),
    db.incident.findMany({ where: { openKey: { not: null } } }),
    db.approval.count({ where: { status: ApprovalStatus.PENDING, createdAt: { lt: new Date(now.getTime() - STALE_AFTER_MS) } } }),
    db.approval.count({ where: { status: ApprovalStatus.PENDING } }),
    db.integration.findMany({ where: { status: { not: IntegrationStatus.OK } } }),
    db.appError.count({ where: { at: { gte: since } } }),
  ]);

  const failed = runs.filter((r) => r.status === JobRunStatus.FAILED);
  const warned = runs.filter((r) => r.status === JobRunStatus.WARNING);
  const lines: string[] = [];
  for (const i of incidents) lines.push(`:red_circle: ${escape(i.title)}`);
  for (const i of integrations) lines.push(`:large_orange_circle: ${escape(i.name)} is ${i.status.toLowerCase()}: ${escape(i.lastError ?? "")}`);
  if (failed.length) lines.push(`• ${failed.length} failed run(s): ${[...new Set(failed.map((r) => r.jobName))].join(", ")}`);
  for (const w of warned) lines.push(`• Warning, ${escape(w.jobName)}: ${escape(w.message ?? "")}`);
  if (errors) lines.push(`• ${errors} app error(s) caught`);
  if (pendingApprovals) {
    lines.push(`• ${pendingApprovals} approval(s) waiting${staleApprovals ? `, ${staleApprovals} for over 48 hours` : ""}`);
  }

  const heading = lines.length ? "*Evo Ops Hub: overnight health*" : "*Evo Ops Hub: all clear overnight*";
  const text = [heading, ...lines, link(appUrl("/admin/health"), "Open Health")].join("\n");
  return { text, issues: lines.length };
}

export async function sendAdminDigest(db: PrismaClient, now = new Date()) {
  const { text, issues } = await buildAdminDigest(db, now);
  const sent = await notifyAdmins(db, text);
  return { sent, issues };
}
