import Link from "next/link";
import { IntegrationStatus, JobRunStatus, Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireModulePage } from "@/lib/guards";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { CopyButton } from "@/components/copy-button";
import { JOBS } from "@/lib/job-registry";
import { AUTOMATION_MODULES, automationState, hubOwnerId } from "@/lib/hub-settings";
import { jobLight, moduleLight, type Light } from "@/lib/health";
import { copyForError } from "@/lib/claude-copy";
import { formatDateOnly, formatTimeLondon, todayInLondon } from "@/lib/time";
import { cn } from "@/lib/utils";
import { RunNowButton } from "../activity/run-now-button";
import { AutomationSwitch, OwnerPicker, TestButtons } from "./controls";

export const metadata = { title: "Health · EvoTasks" };
export const dynamic = "force-dynamic";

const DOT: Record<Light, string> = { green: "bg-success", amber: "bg-warning", red: "bg-destructive" };
const MODULE_LABELS: Record<string, string> = {
  tasks: "Tasks",
  hub: "Hub",
  email: "Email",
  tiktok: "TikTok",
  finance: "Finance",
  reporting: "Reporting",
};

function when(at: Date | null | undefined) {
  if (!at) return "—";
  const day = todayInLondon(at);
  return `${day === todayInLondon() ? "Today" : formatDateOnly(day)} ${formatTimeLondon(at)}`;
}

/**
 * One page for "is everything working": each module green, amber or red, the
 * connections, anything open, and the switches. Admins and the hub owner.
 */
export default async function HealthPage() {
  const user = await requireModulePage("health");
  const isAdmin = user.role === Role.ADMIN;

  const [incidents, integrations, automation, errors, ownerId, people, jobs] = await Promise.all([
    prisma.incident.findMany({ where: { openKey: { not: null } }, orderBy: { openedAt: "asc" } }),
    prisma.integration.findMany({ orderBy: { name: "asc" } }),
    automationState(prisma),
    prisma.appError.findMany({ orderBy: { at: "desc" }, take: 10 }),
    hubOwnerId(prisma),
    prisma.user.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    Promise.all(
      JOBS.map(async (job) => {
        const [last, lastSuccess, warnings] = await Promise.all([
          prisma.jobRun.findFirst({
            where: { jobName: job.name, status: { not: JobRunStatus.RUNNING } },
            orderBy: { startedAt: "desc" },
          }),
          prisma.jobRun.findFirst({
            where: { jobName: job.name, status: JobRunStatus.SUCCESS },
            orderBy: { startedAt: "desc" },
          }),
          prisma.jobRun.count({
            where: {
              jobName: job.name,
              status: JobRunStatus.WARNING,
              startedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
            },
          }),
        ]);
        return { job, last, lastSuccess, warnings };
      }),
    ),
  ]);

  const modules = [...new Set(jobs.map((j) => j.job.module))].map((module) => {
    const rows = jobs
      .filter((j) => j.job.module === module)
      .map((j) => ({ ...j, light: jobLight(j.last, incidents, j.job.name) }));
    const on = automation.global && (automation.modules[module as keyof typeof automation.modules] ?? true);
    return { module, rows, on, light: moduleLight(rows.map((r) => r.light), on) };
  });

  return (
    <AppShell user={user} active="health" title="Health">
      <div className="flex flex-col gap-6 py-6">
        {incidents.length ? (
          <Card className="border-destructive/40 p-5">
            <h2 className="mb-2 font-bold text-destructive">Open incidents</h2>
            <ul className="flex flex-col gap-1 text-sm">
              {incidents.map((i) => (
                <li key={i.id} id={i.key}>
                  <span className="font-medium">{i.title}</span>
                  <span className="text-muted-foreground"> · since {when(i.openedAt)}</span>
                  {i.detail ? <div className="text-xs text-muted-foreground">{i.detail}</div> : null}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <section className="grid gap-3 lg:grid-cols-2">
          {modules.map((m) => (
            <Card key={m.module} className="flex flex-col gap-3 p-5">
              <div className="flex items-center gap-3">
                <span className={cn("h-3 w-3 rounded-full", DOT[m.light])} aria-label={m.light} />
                <h2 className="font-bold">{MODULE_LABELS[m.module] ?? m.module}</h2>
                {!m.on ? <Badge variant="warning">automation paused</Badge> : null}
              </div>
              <ul className="flex flex-col divide-y text-sm">
                {m.rows.map((r) => (
                  <li key={r.job.name} id={`job-${r.job.name}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                    <span className={cn("h-2 w-2 rounded-full", DOT[r.light])} />
                    <Link href={`/admin/activity?job=${r.job.name}`} className="font-mono text-xs hover:underline">
                      {r.job.name}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      last {when(r.last?.startedAt)}
                      {r.last ? ` (${r.last.status.toLowerCase()})` : ""} · last success {when(r.lastSuccess?.startedAt)}
                      {r.warnings ? ` · ${r.warnings} warning(s) this week` : ""}
                    </span>
                    <span className="ml-auto">
                      <RunNowButton job={r.job.name} />
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </section>

        <section className="grid gap-3 lg:grid-cols-2">
          <Card className="p-5">
            <h2 className="mb-3 font-bold">Connections</h2>
            {integrations.length === 0 ? (
              <p className="text-sm text-muted-foreground">No calls recorded yet. Slack appears after its first message.</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {integrations.map((i) => (
                  <li key={i.name} className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "h-2.5 w-2.5 rounded-full",
                        i.status === IntegrationStatus.OK ? DOT.green : i.status === IntegrationStatus.DEGRADED ? DOT.amber : DOT.red,
                      )}
                    />
                    <span className="font-medium capitalize">{i.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {i.status.toLowerCase()} · last success {when(i.lastSuccessAt)}
                      {i.lastError ? ` · last error ${when(i.lastErrorAt)}: ${i.lastError}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="flex flex-col gap-3 p-5">
            <h2 className="font-bold">Automation</h2>
            <p className="text-xs text-muted-foreground">
              Off stops a module taking outside actions (Slack nudges, publishing, Xero) while its screens and the
              approvals queue keep working. Every change is kept with who and why.
            </p>
            <ul className="flex flex-col gap-2 text-sm">
              <li className="flex items-center justify-between gap-3 font-medium">
                Everything
                {isAdmin ? (
                  <AutomationSwitch module="global" label="all" enabled={automation.global} />
                ) : (
                  <Badge variant={automation.global ? "success" : "warning"}>{automation.global ? "on" : "paused"}</Badge>
                )}
              </li>
              {AUTOMATION_MODULES.map((m) => (
                <li key={m} className="flex items-center justify-between gap-3">
                  {MODULE_LABELS[m]}
                  {isAdmin ? (
                    <AutomationSwitch module={m} label={MODULE_LABELS[m]} enabled={automation.modules[m]} />
                  ) : (
                    <Badge variant={automation.modules[m] ? "success" : "warning"}>
                      {automation.modules[m] ? "on" : "paused"}
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </section>

        <Card className="p-5">
          <h2 className="mb-3 font-bold">Recent app errors</h2>
          {errors.length === 0 ? (
            <p className="text-sm text-muted-foreground">None recorded.</p>
          ) : (
            <ul className="flex flex-col divide-y text-sm">
              {errors.map((e) => (
                <li key={e.id} className="flex flex-col gap-1 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">{when(e.at)}</span>
                    <span className="font-mono text-xs">
                      {e.method} {e.path}
                    </span>
                    <span className="ml-auto">
                      <CopyButton text={copyForError(e)} />
                    </span>
                  </div>
                  <div>{e.message}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {isAdmin ? (
          <Card className="flex flex-col gap-4 p-5">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-bold">Hub owner</h2>
              <OwnerPicker people={people} current={ownerId} />
              <p className="w-full text-xs text-muted-foreground">
                Gets the tasks for failing jobs, repeated warnings and expiring connections.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <h2 className="font-bold">End-to-end checks</h2>
              <p className="text-xs text-muted-foreground">
                Harmless: the approval writes one line to the activity log; the task is just a task.
              </p>
              <TestButtons />
            </div>
          </Card>
        ) : null}
      </div>
    </AppShell>
  );
}
