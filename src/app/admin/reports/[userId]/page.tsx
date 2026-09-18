import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Eye } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireAdminPage } from "@/lib/guards";
import { AppShell } from "@/components/app-shell";
import { HistoryTable } from "./history-table";
import { DayChart } from "./day-chart";
import { PersonWindowPicker } from "./person-window-picker";
import { ExportLink } from "../reports-screen";
import { storageEnabled } from "@/lib/storage";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buildPersonReport, buildWindow, dailyBreakdown } from "@/lib/reports";
import { formatDateOnly } from "@/lib/time";
import { cn, formatRate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function PersonReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ days?: string; from?: string; to?: string; filter?: string }>;
}) {
  const admin = await requireAdminPage();
  const { userId } = await params;
  const query = await searchParams;
  // Tiles filter the history below. Held in the URL rather than client state so
  // it survives a refresh and can be sent to someone.
  const filter = (["completed", "late", "missed"] as const).find((f) => f === query.filter);

  const window = buildWindow({
    days: query.days ? Number(query.days) : undefined,
    from: query.from,
    to: query.to,
  });

  const report = await buildPersonReport(prisma, admin.organisationId, userId, window);
  if (!report) notFound();

  const queryString = `from=${window.from}&to=${window.to}`;
  const days = dailyBreakdown(report.history, window);

  return (
    <AppShell user={admin} active="reports">

      <main className="mx-auto w-full max-w-4xl pb-16 pt-2">
        <Link
          href={`/admin/reports?${queryString}`}
          className="-ml-2 mb-2 inline-flex h-10 items-center gap-1.5 px-2 text-sm text-muted-foreground hover:text-foreground"
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
            <div className="mt-3">
              <PersonWindowPicker userId={userId} from={window.from} to={window.to} />
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* The numbers say what happened; this says what they are looking
                at right now, which is the question the numbers prompt. */}
            <Link
              href={`/admin/users/${userId}/day`}
              className="inline-flex h-10 items-center gap-1.5 text-sm font-medium text-primary hover:underline"
            >
              <Eye className="h-4 w-4" />
              Their day
            </Link>
            <ExportLink
              href={`/api/admin/reports/export?panel=person&userId=${userId}&${queryString}`}
            />
          </div>
        </div>

        <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            label="Completion rate"
            value={formatRate(report.totals.completionRate)}
            href={filterHref(queryString, filter === "completed" ? undefined : "completed")}
            active={filter === "completed"}
          />
          <Stat
            label="On-time rate"
            value={formatRate(report.totals.onTimeRate)}
            href={filterHref(queryString, filter === "late" ? undefined : "late")}
            active={filter === "late"}
          />
          <Stat
            label="Assigned"
            value={String(report.totals.assigned)}
            href={filterHref(queryString, undefined)}
            active={!filter}
          />
          <Stat
            label="Missed"
            value={String(report.totals.missed)}
            tone={report.totals.missed > 0 ? "danger" : undefined}
            href={filterHref(queryString, filter === "missed" ? undefined : "missed")}
            active={filter === "missed"}
          />
        </section>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Day by day</CardTitle>
              <CardDescription>
                What was cleared and what was not, each day in this window. Tap a day for the
                tasks behind it.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DayChart days={days} rows={report.history} />
            </CardContent>
          </Card>

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
                    <li
                      key={item.id}
                      className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                    >
                      {/* Stacked on a phone: side by side, the title truncates
                          to a couple of words and stops being identifiable. */}
                      <span className="min-w-0 text-sm font-medium sm:truncate">{item.title}</span>
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
                      style={{ backgroundColor: category.colour ?? "hsl(var(--muted-foreground))" }}
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
              <HistoryTable
                rows={report.history}
                attachmentsEnabled={storageEnabled()}
                filter={filter ?? "all"}
              />
            </CardContent>
          </Card>
        </div>
      </main>
    </AppShell>
  );
}

function Stat({
  label,
  value,
  tone,
  href,
  active = false,
}: {
  label: string;
  value: string;
  tone?: "danger";
  /** Present when the tile filters the history below. */
  href?: string;
  active?: boolean;
}) {
  const card = (
    <Card
      className={cn(
        "h-full transition-colors",
        href && "hover:border-primary/40",
        active && "ring-2 ring-primary",
      )}
    >
      <CardContent className="p-4 sm:p-5">
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

  if (!href) return card;

  return (
    <Link href={href} aria-pressed={active} className="block rounded-lg">
      {card}
    </Link>
  );
}

/** The current window, with the status filter swapped in or dropped. */
function filterHref(queryString: string, filter: string | undefined): string {
  const params = new URLSearchParams(queryString);
  if (filter) params.set("filter", filter);
  else params.delete("filter");
  return `?${params.toString()}`;
}
