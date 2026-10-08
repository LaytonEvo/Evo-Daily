import Link from "next/link";
import { JobRunStatus, type JobRun } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireModulePage } from "@/lib/guards";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { JOBS } from "@/lib/job-registry";
import { formatDateOnly, formatTimeLondon, todayInLondon } from "@/lib/time";
import { RunNowButton } from "./run-now-button";

export const metadata = { title: "Activity · EvoTasks" };
export const dynamic = "force-dynamic";

const STATUS_BADGE: Record<JobRunStatus, "muted" | "success" | "warning" | "destructive"> = {
  RUNNING: "muted",
  SUCCESS: "success",
  WARNING: "warning",
  FAILED: "destructive",
};

function when(at: Date) {
  const day = todayInLondon(at);
  return `${day === todayInLondon() ? "Today" : formatDateOnly(day, { weekday: true })} ${formatTimeLondon(at)}`;
}

function duration(run: JobRun) {
  if (!run.finishedAt) return "—";
  const ms = run.finishedAt.getTime() - run.startedAt.getTime();
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/**
 * The hub's activity log: what ran, when, and whether it worked. Admins see
 * it; so does anyone granted the Activity module, such as the hub owner.
 */
export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string; status?: string }>;
}) {
  const user = await requireModulePage("activity");
  const params = await searchParams;
  const status = params.status && params.status in JobRunStatus ? (params.status as JobRunStatus) : undefined;
  const job = params.job && JOBS.some((j) => j.name === params.job) ? params.job : undefined;

  const [runs, latest] = await Promise.all([
    prisma.jobRun.findMany({
      where: { ...(job ? { jobName: job } : {}), ...(status ? { status } : {}) },
      orderBy: { startedAt: "desc" },
      take: 100,
    }),
    Promise.all(
      JOBS.map(async (j) => ({
        job: j,
        last: await prisma.jobRun.findFirst({ where: { jobName: j.name }, orderBy: { startedAt: "desc" } }),
        lastSuccess: await prisma.jobRun.findFirst({
          where: { jobName: j.name, status: JobRunStatus.SUCCESS },
          orderBy: { startedAt: "desc" },
        }),
      })),
    ),
  ]);

  const filterLink = (next: { job?: string; status?: string }) => {
    const q = new URLSearchParams();
    const merged = { job, status, ...next };
    if (merged.job) q.set("job", merged.job);
    if (merged.status) q.set("status", merged.status);
    const s = q.toString();
    return `/admin/activity${s ? `?${s}` : ""}`;
  };

  return (
    <AppShell user={user} active="activity" title="Activity">
      <div className="flex flex-col gap-6 py-6">
        <section className="grid gap-3 md:grid-cols-2">
          {latest.map(({ job: j, last, lastSuccess }) => (
            <Card key={j.name} className="flex flex-col gap-3 p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-mono text-sm font-bold">{j.name}</div>
                  <div className="text-xs text-muted-foreground">{j.schedule}</div>
                </div>
                <RunNowButton job={j.name} />
              </div>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Last run</dt>
                  <dd>
                    {last ? (
                      <span className="flex flex-wrap items-center gap-1.5">
                        {when(last.startedAt)}
                        <Badge variant={STATUS_BADGE[last.status]}>{last.status.toLowerCase()}</Badge>
                      </span>
                    ) : (
                      "Not since the log started"
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Last success</dt>
                  <dd>{lastSuccess ? when(lastSuccess.startedAt) : "—"}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-xs text-muted-foreground">Good run</dt>
                  <dd>{j.goodRun}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-xs text-muted-foreground">Warning if</dt>
                  <dd>{j.warningIf}</dd>
                </div>
              </dl>
            </Card>
          ))}
        </section>

        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3 text-sm">
            <span className="mr-auto font-bold">Runs</span>
            {(["FAILED", "WARNING", "SUCCESS"] as const).map((s) => (
              <Link
                key={s}
                href={filterLink({ status: status === s ? undefined : s })}
                className={status === s ? "font-bold text-primary" : "text-muted-foreground hover:text-foreground"}
              >
                {s.toLowerCase()}
              </Link>
            ))}
            {job || status ? (
              <Link href="/admin/activity" className="text-muted-foreground hover:text-foreground">
                clear
              </Link>
            ) : null}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="px-5 py-2 font-medium">Started</th>
                  <th className="px-3 py-2 font-medium">Job</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="hidden px-3 py-2 font-medium sm:table-cell">Took</th>
                  <th className="px-3 py-2 font-medium">What happened</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id} className="border-t align-top">
                    <td className="whitespace-nowrap px-5 py-2.5">{when(run.startedAt)}</td>
                    <td className="px-3 py-2.5">
                      <Link href={filterLink({ job: run.jobName })} className="font-mono text-xs hover:underline">
                        {run.jobName}
                      </Link>
                      <div className="text-xs text-muted-foreground">{run.trigger}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge variant={STATUS_BADGE[run.status]}>{run.status.toLowerCase()}</Badge>
                    </td>
                    <td className="hidden whitespace-nowrap px-3 py-2.5 sm:table-cell">{duration(run)}</td>
                    <td className="px-3 py-2.5">
                      {run.message}
                      {run.details ? (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-xs text-muted-foreground">Details</summary>
                          <pre className="mt-1 max-w-xl overflow-x-auto rounded bg-muted p-2 text-xs">
                            {JSON.stringify(run.details, null, 2)}
                          </pre>
                        </details>
                      ) : null}
                    </td>
                  </tr>
                ))}
                {runs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-8 text-center text-muted-foreground">
                      No runs yet. They appear here from the next scheduled run, or press Run now.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
