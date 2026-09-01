"use client";

import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { AlertTriangle, Download, TrendingDown, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, formatDelta, formatRate } from "@/lib/utils";
import { formatDateOnly } from "@/lib/time";
import type { LeaderboardRow, OrgReport } from "@/lib/reports";
import { WindowPicker } from "./window-picker";
import { TrendChart } from "./trend-chart";

type SortKey = keyof Pick<
  LeaderboardRow,
  "name" | "assigned" | "completed" | "missed" | "completionRate" | "onTimeRate"
>;

export function ReportsScreen({ report }: { report: OrgReport }) {
  const { window, totals, deltas } = report;
  const query = `from=${window.from}&to=${window.to}`;

  return (
    <main className="mx-auto w-full max-w-5xl pb-16 pt-2">
      <div className="mb-5">
        <p className="text-sm text-muted-foreground">
          {formatDateOnly(window.from, { withYear: true })} to{" "}
          {formatDateOnly(window.to, { withYear: true })} · {window.days} days
          {window.requestedTo !== window.to ? " (clipped to today)" : ""}
        </p>
      </div>

      <div className="mb-6">
        <Suspense fallback={null}>
          <WindowPicker from={window.from} to={window.to} />
        </Suspense>
      </div>

      {/* --- Org summary --------------------------------------------------- */}
      <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Completion rate"
          value={formatRate(totals.completionRate)}
          delta={deltas.completionRate}
          sub={`${totals.completed} of ${totals.assigned} due`}
        />
        <Stat
          label="On-time rate"
          value={formatRate(totals.onTimeRate)}
          delta={deltas.onTimeRate}
          sub={`${totals.onTime} of ${totals.completed} completed`}
        />
        <Stat
          label="Completed"
          value={String(totals.completed)}
          count={deltas.completed}
          sub="tasks ticked off"
        />
        <Stat
          label="Missed"
          value={String(totals.missed)}
          count={deltas.missed}
          invert
          sub={`${totals.outstanding} still open`}
        />
      </section>

      <div className="flex flex-col gap-6">
        <Leaderboard rows={report.leaderboard} query={query} />

        <Card>
          <CardHeader className="flex-row items-start justify-between gap-3">
            <div>
              <CardTitle>Trend</CardTitle>
              <CardDescription>
                Daily completion rate, with a 7-day moving average.
              </CardDescription>
            </div>
            <ExportLink href={`/api/admin/reports/export?panel=trend&${query}`} />
          </CardHeader>
          <CardContent>
            <TrendChart points={report.trend} />
          </CardContent>
        </Card>

        <ProblemTasks report={report} query={query} />
        <Categories report={report} query={query} />

        <Card>
          <CardHeader className="flex-row items-start justify-between gap-3">
            <div>
              <CardTitle>Raw export</CardTitle>
              <CardDescription>
                One row per instance with every field, for offline analysis.
              </CardDescription>
            </div>
            <ExportLink
              href={`/api/admin/reports/export?panel=instances&${query}`}
              label="Download instances"
            />
          </CardHeader>
        </Card>
      </div>
    </main>
  );
}

function Stat({
  label,
  value,
  sub,
  delta,
  count,
  invert = false,
}: {
  label: string;
  value: string;
  sub: string;
  delta?: number | null;
  count?: number;
  invert?: boolean;
}) {
  const change = delta ?? (count === undefined ? null : count / 100);
  const isUp = change !== null && change > 0;
  const good = invert ? !isUp : isUp;

  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
        {change !== null && change !== 0 ? (
          <p
            className={cn(
              "mt-2 inline-flex items-center gap-1 text-xs font-medium",
              good ? "text-success" : "text-destructive",
            )}
          >
            {isUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {delta !== undefined
              ? formatDelta(delta)
              : `${count! > 0 ? "+" : ""}${count} vs previous`}
          </p>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">vs previous period</p>
        )}
      </CardContent>
    </Card>
  );
}

function Leaderboard({ rows, query }: { rows: LeaderboardRow[]; query: string }) {
  const [sort, setSort] = useState<SortKey>("completionRate");
  const [ascending, setAscending] = useState(false);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      // Low-volume people stay pinned below the rest whatever the sort, so a
      // 3-for-3 never appears to be outperforming someone carrying 80 tasks.
      if (a.lowVolume !== b.lowVolume) return a.lowVolume ? 1 : -1;
      const left = a[sort];
      const right = b[sort];
      if (typeof left === "string" && typeof right === "string") {
        return ascending ? left.localeCompare(right) : right.localeCompare(left);
      }
      const l = (left as number | null) ?? -1;
      const r = (right as number | null) ?? -1;
      return ascending ? l - r : r - l;
    });
    return copy;
  }, [rows, sort, ascending]);

  function header(key: SortKey, label: string, className?: string) {
    return (
      <th className={cn("px-2 py-2.5 sm:px-3 font-medium", className)}>
        <button
          type="button"
          className="inline-flex items-center gap-1 hover:text-foreground"
          onClick={() => {
            if (sort === key) setAscending((v) => !v);
            else {
              setSort(key);
              setAscending(false);
            }
          }}
        >
          {label}
          {sort === key ? <span aria-hidden="true">{ascending ? "▲" : "▼"}</span> : null}
        </button>
      </th>
    );
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Leaderboard</CardTitle>
          <CardDescription>
            Per person, over this window. Attribution follows the instance, not the task.
          </CardDescription>
        </div>
        <ExportLink href={`/api/admin/reports/export?panel=leaderboard&${query}`} />
      </CardHeader>
      <CardContent className="px-0 sm:px-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm sm:min-w-[640px]">
            <thead className="border-y bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                {header("name", "Person")}
                {header("assigned", "Assigned", "hidden text-right sm:table-cell")}
                {header("completed", "Completed", "text-right")}
                {header("missed", "Missed", "text-right")}
                {header("completionRate", "Completion", "text-right")}
                {header("onTimeRate", "On time", "hidden text-right sm:table-cell")}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <tr key={row.userId} className="border-b last:border-0 hover:bg-accent/50">
                  <td className="px-2 py-2.5 sm:px-3">
                    <Link
                      href={`/admin/reports/${row.userId}?${query}`}
                      className="font-medium hover:underline"
                    >
                      {row.name}
                    </Link>
                    {row.lowVolume ? (
                      <Badge variant="muted" className="ml-2">
                        low volume
                      </Badge>
                    ) : null}
                    {!row.isActive ? (
                      <Badge variant="muted" className="ml-2">
                        inactive
                      </Badge>
                    ) : null}
                  </td>
                  <td className="hidden px-2 py-2.5 text-right tabular-nums sm:table-cell sm:px-3">
                    {row.assigned}
                  </td>
                  <td className="px-2 py-2.5 sm:px-3 text-right tabular-nums">{row.completed}</td>
                  <td
                    className={cn(
                      "px-2 py-2.5 sm:px-3 text-right tabular-nums",
                      row.missed > 0 && "text-destructive",
                    )}
                  >
                    {row.missed}
                  </td>
                  <td className="px-2 py-2.5 sm:px-3 text-right">
                    <RateBar rate={row.completionRate} />
                  </td>
                  <td className="hidden px-2 py-2.5 text-right tabular-nums text-muted-foreground sm:table-cell sm:px-3">
                    {formatRate(row.onTimeRate)}
                  </td>
                </tr>
              ))}
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-10 text-center text-muted-foreground">
                    Nothing was due in this window.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function ProblemTasks({ report, query }: { report: OrgReport; query: string }) {
  // No slice: the panel shows every row its CSV exports, so the two can never
  // disagree on a count.
  const worst = report.problemTasks;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warning" />
            Problem tasks
          </CardTitle>
          <CardDescription>
            Worst completion rate, minimum 5 instances in the window. A task nobody completes is
            usually a badly-designed task, a wrongly-assigned task, or one that should be
            automated — not a people problem.
          </CardDescription>
        </div>
        <ExportLink href={`/api/admin/reports/export?panel=problem-tasks&${query}`} />
      </CardHeader>
      <CardContent className="px-0 sm:px-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm sm:min-w-[640px]">
            <thead className="border-y bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-2 py-2.5 sm:px-3 font-medium">Task</th>
                <th className="hidden px-2 py-2.5 font-medium sm:table-cell sm:px-3">Owner</th>
                <th className="hidden px-2 py-2.5 font-medium sm:table-cell sm:px-3">Schedule</th>
                <th className="px-2 py-2.5 sm:px-3 text-right font-medium">Due</th>
                <th className="px-2 py-2.5 sm:px-3 text-right font-medium">Missed</th>
                <th className="px-2 py-2.5 sm:px-3 text-right font-medium">Completion</th>
              </tr>
            </thead>
            <tbody>
              {worst.map((task) => (
                <tr key={task.templateId} className="border-b last:border-0">
                  <td className="max-w-[44vw] px-2 py-2.5 font-medium sm:max-w-none sm:px-3">
                    {task.title}
                    {task.categoryName ? (
                      <span className="ml-2 text-xs text-muted-foreground">
                        {task.categoryName}
                      </span>
                    ) : null}
                    {!task.isActive ? (
                      <Badge variant="muted" className="ml-2">
                        inactive
                      </Badge>
                    ) : null}
                    <span className="block max-w-[42vw] truncate text-xs font-normal text-muted-foreground sm:hidden">
                      {task.assigneeName} · {task.schedule}
                    </span>
                  </td>
                  <td className="hidden px-2 py-2.5 text-muted-foreground sm:table-cell sm:px-3">
                    {task.assigneeName}
                  </td>
                  <td className="hidden px-2 py-2.5 text-muted-foreground sm:table-cell sm:px-3">
                    {task.schedule}
                  </td>
                  <td className="px-2 py-2.5 sm:px-3 text-right tabular-nums">{task.assigned}</td>
                  <td
                    className={cn(
                      "px-2 py-2.5 sm:px-3 text-right tabular-nums",
                      task.missed > 0 && "text-destructive",
                    )}
                  >
                    {task.missed}
                  </td>
                  <td className="px-2 py-2.5 sm:px-3 text-right">
                    <RateBar rate={task.completionRate} />
                  </td>
                </tr>
              ))}
              {worst.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-10 text-center text-muted-foreground">
                    Nothing to flag — every task with 5 or more instances in this window was
                    completed.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function Categories({ report, query }: { report: OrgReport; query: string }) {
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>By category</CardTitle>
          <CardDescription>Which area of the business is slipping.</CardDescription>
        </div>
        <ExportLink href={`/api/admin/reports/export?panel=categories&${query}`} />
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
              <span className="w-40 shrink-0 truncate text-sm font-medium">{category.name}</span>
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
              <span className="w-24 shrink-0 text-right text-sm tabular-nums">
                {formatRate(category.completionRate)}
                <span className="ml-1 text-xs text-muted-foreground">({category.assigned})</span>
              </span>
            </div>
          ))}
          {report.categories.length === 0 ? (
            <p className="py-6 text-center text-muted-foreground">
              Nothing was due in this window.
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

export function RateBar({ rate }: { rate: number | null }) {
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-muted sm:block">
        <span
          className={cn(
            "block h-full rounded-full",
            (rate ?? 0) >= 0.9 ? "bg-success" : (rate ?? 0) >= 0.7 ? "bg-warning" : "bg-destructive",
          )}
          style={{ width: `${(rate ?? 0) * 100}%` }}
        />
      </span>
      <span className="w-10 text-right font-medium tabular-nums">{formatRate(rate)}</span>
    </span>
  );
}

function ExportLink({ href, label = "CSV" }: { href: string; label?: string }) {
  return (
    <a
      href={href}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-input bg-card px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
    >
      <Download className="h-3.5 w-3.5" />
      {label}
    </a>
  );
}
