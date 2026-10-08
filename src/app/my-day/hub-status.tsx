import Link from "next/link";
import { IntegrationStatus, JobRunStatus } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * The admin status strip, as one line, only when something needs looking at:
 * open incidents, connections not OK, and failed or warning runs in the last
 * day. Silent the rest of the time — a strip that always says "all fine" is
 * one nobody reads. Approvals have their own line beside it.
 */
export async function HubStatus() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [counts, incidents, integrations] = await Promise.all([
    prisma.jobRun.groupBy({
      by: ["status"],
      where: { startedAt: { gte: since }, status: { in: [JobRunStatus.FAILED, JobRunStatus.WARNING] } },
      _count: true,
    }),
    prisma.incident.count({ where: { openKey: { not: null } } }),
    prisma.integration.findMany({ where: { status: { not: IntegrationStatus.OK } }, select: { name: true, status: true } }),
  ]);
  const failed = counts.find((c) => c.status === JobRunStatus.FAILED)?._count ?? 0;
  const warnings = counts.find((c) => c.status === JobRunStatus.WARNING)?._count ?? 0;
  if (!failed && !warnings && !incidents && integrations.length === 0) return null;

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const parts = [
    incidents ? plural(incidents, "open incident") : null,
    ...integrations.map((i) => `${i.name} ${i.status.toLowerCase()}`),
    failed ? plural(failed, "failed job run") : null,
    warnings ? plural(warnings, "warning") : null,
  ].filter(Boolean);
  const serious = incidents > 0 || failed > 0 || integrations.some((i) => i.status === IntegrationStatus.DOWN);

  return (
    <Link
      href="/admin/health"
      className={`mt-4 block rounded-lg px-4 py-2.5 text-sm font-medium ${
        serious ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning"
      }`}
    >
      {parts.join(" · ")}. Open Health →
    </Link>
  );
}
