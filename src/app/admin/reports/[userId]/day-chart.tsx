"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DayBreakdown } from "@/lib/reports";
import { formatDateOnly, formatDateOnlyLong } from "@/lib/time";
import { cn } from "@/lib/utils";
import { InstanceRows, type HistoryRow } from "./history-table";

/**
 * Completed and missed, day by day.
 *
 * The tiles above say what the month came to; this says which days it came
 * from, which is the question a manager actually asks next. Bars rather than a
 * line because the counts are small integers — three missed on Tuesday is a
 * fact, and a smoothed curve through it is a decoration.
 *
 * Every column is clickable and opens the tasks behind it. A chart that shows
 * two missed on the 15th and cannot tell you which two is a chart you have to
 * leave to act on.
 */
export function DayChart({
  days,
  rows,
  attachmentsEnabled,
  today,
}: {
  days: DayBreakdown[];
  /** Every instance in the window — the same rows the history table holds. */
  rows: HistoryRow[];
  attachmentsEnabled: boolean;
  today: string;
}) {
  const [openDate, setOpenDate] = useState<string | null>(null);

  /** Clicking the open day again closes it. */
  function toggleDate(date: string) {
    setOpenDate((current) => (current === date ? null : date));
  }

  /**
   * Recharts reports `activeIndex: null` for a click that lands on a bar, and
   * `Number(null)` is 0 — reading it opens the first day in the window whatever
   * you clicked. The bar's own handler is given the datum, so it needs neither.
   */
  function onBarClick(datum: unknown, _index: number, event?: { stopPropagation?: () => void }) {
    // Both handlers fire for a click on a bar once the tooltip is already
    // showing, and two toggles are no toggle — the panel would never close.
    event?.stopPropagation?.();
    const date =
      (datum as { payload?: { date?: string }; date?: string })?.payload?.date ??
      (datum as { date?: string })?.date;
    if (typeof date === "string") toggleDate(date);
  }

  const data = useMemo(
    () =>
      days.map((day) => ({
        ...day,
        onTime: day.completed - day.late,
      })),
    [days],
  );

  const byDate = useMemo(() => {
    const map = new Map<string, HistoryRow[]>();
    for (const row of rows) {
      const list = map.get(row.dueDate) ?? [];
      list.push(row);
      map.set(row.dueDate, list);
    }
    return map;
  }, [rows]);

  const busiest = Math.max(1, ...days.map((d) => d.completed + d.missed + d.open));
  const open = openDate ? (byDate.get(openDate) ?? []) : [];
  const openDay = openDate ? days.find((d) => d.date === openDate) : undefined;

  if (days.length === 0) {
    return <p className="py-10 text-center text-muted-foreground">Nothing was due in this window.</p>;
  }

  return (
    <div>
      {/* Wide windows scroll rather than squeezing 90 days into 320px, where
          every bar is a hairline and none of them is clickable. */}
      <div className="overflow-x-auto">
        <div
          style={{ minWidth: Math.max(320, days.length * 22) }}
          // Clicking a bar focuses an inner <g> that recharts renders, and
          // Chromium rings it with a box spanning every bar drawn. Nothing in
          // the chart is reachable by keyboard, so the ring marks nothing and
          // only looks broken — the same figures are in the history table
          // below, row by row, which is what a keyboard or a screen reader
          // gets. Any focused descendant, because the element that takes focus
          // is an implementation detail of the chart library.
          className="h-56 [&_:focus]:outline-none"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              margin={{ top: 8, right: 8, bottom: 0, left: -24 }}
              barCategoryGap="18%"
              // For clicks in the column but not on the ink. A click that lands
              // on a bar reports no active anything here — the bars carry their
              // own handler for that. activeLabel is the ISO date because that
              // is what the axis is keyed on.
              onClick={(state) => {
                const date = state?.activeLabel;
                if (typeof date === "string") toggleDate(date);
              }}
            >
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={(value: string) => formatDateOnly(value)}
                tick={{ fontSize: 11 }}
                interval="preserveStartEnd"
                minTickGap={24}
                className="fill-muted-foreground"
              />
              <YAxis
                allowDecimals={false}
                domain={[0, busiest]}
                tick={{ fontSize: 11 }}
                className="fill-muted-foreground"
              />
              <Tooltip
                // Explicit fill and an off stroke: a Tailwind class here leaves
                // the SVG rect with its default black outline, which draws a box
                // across half the chart.
                cursor={{ fill: "hsl(var(--accent))", fillOpacity: 0.6, stroke: "none" }}
                contentStyle={{
                  borderRadius: 8,
                  border: "1px solid hsl(var(--border))",
                  backgroundColor: "hsl(var(--card))",
                  fontSize: 12,
                }}
                content={<DayTooltip />}
              />
              <Bar
                dataKey="onTime"
                stackId="day"
                onClick={onBarClick}
                name="On time"
                fill="hsl(var(--success))"
                isAnimationActive={false}
                className="cursor-pointer"
              />
              <Bar
                dataKey="late"
                stackId="day"
                onClick={onBarClick}
                name="Late"
                fill="hsl(var(--warning))"
                isAnimationActive={false}
                className="cursor-pointer"
              />
              <Bar
                dataKey="missed"
                stackId="day"
                onClick={onBarClick}
                name="Missed"
                fill="hsl(var(--destructive))"
                isAnimationActive={false}
                className="cursor-pointer"
              />
              {/* On top, and deliberately drawn at all: without it a day where
                  nothing was done and nothing has aged out yet is an empty
                  column, which looks exactly like a day nobody was working. */}
              <Bar
                dataKey="open"
                stackId="day"
                onClick={onBarClick}
                name="Still open"
                fill="hsl(var(--muted-foreground))"
                fillOpacity={0.35}
                radius={[3, 3, 0, 0]}
                isAnimationActive={false}
                className="cursor-pointer"
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs text-muted-foreground">
        <Key className="bg-success" label="On time" />
        <Key className="bg-warning" label="Late" />
        <Key className="bg-destructive" label="Missed" />
        <Key className="bg-muted-foreground/35" label="Still open" />
        <span className="ml-auto">Tap a day to see what was on it.</span>
      </div>

      {openDay ? (
        <div data-testid="day-detail" className="mt-4 rounded-lg border bg-muted/30 p-3 animate-fade-in">
          <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className="text-sm font-semibold">{formatDateOnlyLong(openDay.date)}</h3>
            <p className="text-xs text-muted-foreground">
              {openDay.completed} done{openDay.late > 0 ? ` (${openDay.late} late)` : ""} ·{" "}
              {openDay.missed} missed
              {openDay.open > 0 ? ` · ${openDay.open} still open` : ""}
            </p>
            <p className="text-xs text-muted-foreground">
              Week to this day: {openDay.weekCompleted} done, {openDay.weekMissed} missed
            </p>
            <button
              type="button"
              onClick={() => setOpenDate(null)}
              className="ml-auto text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Close
            </button>
          </div>

          {open.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">Nothing was due that day.</p>
          ) : (
            // The same rows as everywhere else on the page: open one for its
            // thread, or write it off, without leaving the chart.
            <div className="-mx-3 overflow-hidden rounded-lg border bg-card">
              <InstanceRows
                rows={open}
                attachmentsEnabled={attachmentsEnabled}
                today={today}
                showDue={false}
              />
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Key({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className={cn("h-2.5 w-2.5 rounded-sm", className)} />
      {label}
    </span>
  );
}


type TooltipPayload = { payload: DayBreakdown & { onTime: number } };

function DayTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayload[] }) {
  const day = payload?.[0]?.payload;
  if (!active || !day) return null;

  return (
    <div className="rounded-lg border bg-card px-3 py-2 text-xs shadow-card">
      <p className="font-semibold">{formatDateOnlyLong(day.date)}</p>
      {day.assigned === 0 ? (
        <p className="mt-0.5 text-muted-foreground">Nothing due.</p>
      ) : (
        <p className="mt-0.5">
          {day.completed} done{day.late > 0 ? `, ${day.late} late` : ""}
          {day.missed > 0 ? `, ${day.missed} missed` : ""}
          {day.open > 0 ? `, ${day.open} still open` : ""}
        </p>
      )}
      {/* The running week is why one bad day is not an emergency. */}
      <p className="mt-1 text-muted-foreground">
        Week to date: {day.weekCompleted} done, {day.weekMissed} missed
      </p>
    </div>
  );
}
