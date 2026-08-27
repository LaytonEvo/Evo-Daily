import Link from "next/link";
import { notFound } from "next/navigation";
import { InstanceStatus } from "@prisma/client";
import { ArrowLeft, Download } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireAdminPage } from "@/lib/guards";
import { AppHeader } from "@/components/app-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buildPersonReport, buildWindow } from "@/lib/reports";
import { formatDateOnly, formatTimeLondon } from "@/lib/time";
import { cn, formatRate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function PersonReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ days?: string; from?: string; to?: string }>;
}) {
  const admin = await requireAdminPage();
  const { userId } = await params;
  const query = await searchParams;

  const window = buildWindow({
    days: query.days ? Number(query.days) : undefined,
    from: query.from,
    to: query.to,
  });

  const report = await buildPersonReport(prisma, admin.organisationId, userId, window);
  if (!report) notFound();

  const queryString = `from=${window.from}&to=${window.to}`;

  return (
    <div className="min-h-dvh">
      <AppHeader user={admin} active="reports" />

      <main className="mx-auto w-full max-w-4xl px-4 pb-16 pt-5">
        <Link
          href={`/admin/reports?${queryString}`}
          className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          All reports
        </Link>

        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {report.user.name}
              {!report.user.isActive ? (
                <Badge variant="muted" className="ml-2 align-middle">
                  inactive
                </Badge>
              ) : null}
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {formatDateOnly(window.from, { withYear: true })} to{" "}
              {formatDateOnly(window.to, { withYear: true })}
            </p>
          </div>
          <a
            href={`/api/admin/reports/export?panel=person&userId=${userId}&${queryString}`}
            className="inline-flex items-center gap-1.5 rounded-md border border-input bg-card px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
          >
            <Download className="h-3.5 w-3.5" />
            CSV
          </a>
        </div>

        <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Completion rate" value={formatRate(report.totals.completionRate)} />
          <Stat label="On-time rate" value={formatRate(report.totals.onTimeRate)} />
          <Stat label="Assigned" value={String(report.totals.assigned)} />
          <Stat
            label="Missed"
            value={String(report.totals.missed)}
            tone={report.totals.missed > 0 ? "danger" : undefined}
          />
        </section>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Missed tasks</CardTitle>
              <CardDescription>
                Every missed task in this window, with the date it was due.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {report.missed.length === 0 ? (
                <p className="py-4 text-sm text-success">Nothing missed in this window.</p>
              ) : (
                <ul className="flex flex-col divide-y">
                  {report.missed.map((item) => (
                    <li key={item.id} className="flex items-center justify-between gap-3 py-2.5">
                      <span className="min-w-0 truncate text-sm font-medium">{item.title}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {item.categoryName ? `${item.categoryName} · ` : ""}
                        {formatDateOnly(item.dueDate)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>By category</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-3">
                {report.categories.map((category) => (
                  <div key={category.categoryId ?? "none"} className="flex items-center gap-3">
                    <span
                      aria-hidden="true"
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: category.colour ?? "#94a3b8" }}
                    />
                    <span className="w-36 shrink-0 truncate text-sm font-medium">
                      {category.name}
                    </span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          (category.completionRate ?? 0) >= 0.9
                            ? "bg-success"
                            : (category.completionRate ?? 0) >= 0.7
                              ? "bg-warning"
                              : "bg-destructive",
                        )}
                        style={{ width: `${(category.completionRate ?? 0) * 100}%` }}
                      />
                    </div>
                    <span className="w-20 shrink-0 text-right text-sm tabular-nums">
                      {formatRate(category.completionRate)}
                      <span className="ml-1 text-xs text-muted-foreground">
                        ({category.assigned})
                      </span>
                    </span>
                  </div>
                ))}
                {report.categories.length === 0 ? (
                  <p className="py-4 text-sm text-muted-foreground">
                    Nothing was due in this window.
                  </p>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Instance history</CardTitle>
              <CardDescription>{report.history.length} instances in this window.</CardDescription>
            </CardHeader>
            <CardContent className="px-0 sm:px-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[600px] text-sm">
                  <thead className="border-y bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2.5 font-medium">Due</th>
                      <th className="px-3 py-2.5 font-medium">Task</th>
                      <th className="px-3 py-2.5 font-medium">Status</th>
                      <th className="px-3 py-2.5 font-medium">Completed</th>
                      <th className="px-3 py-2.5 font-medium">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.history.map((row) => (
                      <tr key={row.id} className="border-b last:border-0">
                        <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">
                          {formatDateOnly(row.dueDate)}
                        </td>
                        <td className="px-3 py-2.5 font-medium">{row.title}</td>
                        <td className="px-3 py-2.5">
                          <StatusBadge status={row.status} wasLate={row.wasLate} />
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">
                          {row.completedAt
                            ? `${formatDateOnly(row.completedAt.toISOString().slice(0, 10))} ${formatTimeLondon(row.completedAt)}`
                            : "—"}
                        </td>
                        <td className="max-w-[220px] truncate px-3 py-2.5 text-muted-foreground">
                          {row.note ?? ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "danger";
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p
          className={cn(
            "mt-1 text-2xl font-bold tabular-nums",
            tone === "danger" && "text-destructive",
          )}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status, wasLate }: { status: InstanceStatus; wasLate: boolean }) {
  if (status === InstanceStatus.COMPLETED) {
    return wasLate ? <Badge variant="warning">Completed late</Badge> : <Badge variant="success">Completed</Badge>;
  }
  if (status === InstanceStatus.MISSED) return <Badge variant="destructive">Missed</Badge>;
  return <Badge variant="muted">Open</Badge>;
}
