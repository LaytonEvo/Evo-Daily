import Link from "next/link";
import { JobRunStatus } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * One line, only when something needs looking at: background jobs that
 * failed or warned in the last day. Shown to whoever can open the Activity
 * page, and silent the rest of the time — a status strip that always says
 * "all fine" is one nobody reads.
 */
export async function HubStatus() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const counts = await prisma.jobRun.groupBy({
    by: ["status"],
    where: { startedAt: { gte: since }, status: { in: [JobRunStatus.FAILED, JobRunStatus.WARNING] } },
    _count: true,
  });
  const failed = counts.find((c) => c.status === JobRunStatus.FAILED)?._count ?? 0;
  const warnings = counts.find((c) => c.status === JobRunStatus.WARNING)?._count ?? 0;
  if (failed === 0 && warnings === 0) return null;

  const parts = [
    failed ? `${failed} failed job run${failed === 1 ? "" : "s"}` : null,
    warnings ? `${warnings} warning${warnings === 1 ? "" : "s"}` : null,
  ].filter(Boolean);

  return (
    <Link
      href={`/admin/activity?status=${failed ? "FAILED" : "WARNING"}`}
      className={`mt-4 block rounded-lg px-4 py-2.5 text-sm font-medium ${
        failed ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning"
      }`}
    >
      {parts.join(" and ")} in the last 24 hours. Open Activity →
    </Link>
  );
}
