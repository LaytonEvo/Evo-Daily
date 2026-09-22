"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { WeekGroup } from "@/lib/reports";
import { formatDateOnly } from "@/lib/time";
import { cn } from "@/lib/utils";

/**
 * Weeks that open into days that open into tasks.
 *
 * A ninety-day window is several hundred rows, and a flat list of them is a
 * scrollbar rather than an answer. Here the whole window fits on a screen as
 * week headings, and you go down into the one you are asking about.
 *
 * The newest week opens by default, and its newest day with it. A one-day
 * window therefore reads as a plain list with two headings above it, which is
 * what it should look like — the drill-down is for the case that needs it and
 * out of the way in the case that does not.
 */
export function WeekDrill<T>({
  weeks,
  renderRows,
  emptyLabel,
}: {
  weeks: WeekGroup<T>[];
  renderRows: (rows: T[]) => React.ReactNode;
  emptyLabel: string;
}) {
  const newestWeek = weeks[0]?.from;
  const newestDay = weeks[0]?.days[0]?.date;

  const [openWeeks, setOpenWeeks] = useState<Set<string>>(
    () => new Set(newestWeek ? [newestWeek] : []),
  );
  const [openDays, setOpenDays] = useState<Set<string>>(
    () => new Set(newestDay ? [newestDay] : []),
  );

  function toggle(set: Set<string>, key: string, apply: (next: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    apply(next);
  }

  if (weeks.length === 0) {
    return <p className="px-4 py-6 text-sm text-muted-foreground sm:px-0">{emptyLabel}</p>;
  }

  return (
    <div className="flex flex-col divide-y">
      {weeks.map((week) => {
        const weekOpen = openWeeks.has(week.from);
        return (
          <div key={week.from}>
            <Row
              open={weekOpen}
              onToggle={() => toggle(openWeeks, week.from, setOpenWeeks)}
              title={week.label}
              // Only "This week" and "Last week" need the dates spelling out.
              // Every other label already is the dates, and printing them
              // twice looks like a bug.
              subtitle={weekRange(week.from, week.to) === week.label ? "" : weekRange(week.from, week.to)}
              counts={countsOf(week.totals, week.overdue)}
              level="week"
            />

            {weekOpen ? (
              <div className="flex flex-col divide-y border-t bg-muted/20">
                {week.days.map((day) => {
                  const dayOpen = openDays.has(day.date);
                  return (
                    <div key={day.date}>
                      <Row
                        open={dayOpen}
                        onToggle={() => toggle(openDays, day.date, setOpenDays)}
                        title={formatDateOnly(day.date)}
                        subtitle={`${day.totals.assigned} task${
                          day.totals.assigned === 1 ? "" : "s"
                        }`}
                        counts={countsOf(day.totals, day.overdue)}
                        level="day"
                      />
                      {dayOpen ? (
                        <div className="border-t bg-background">{renderRows(day.rows)}</div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

type Counts = { assigned: number; completed: number; missed: number; overdue: number; open: number };

/**
 * What a collapsed row should say about itself.
 *
 * `open` here is open and *not yet late* — today's work. Keeping it separate
 * from overdue matters: the first version called a day "all done" whenever
 * nothing had gone wrong yet, so today with three of four still to do wore a
 * green badge all morning.
 */
function countsOf(
  totals: { assigned: number; completed: number; missed: number; outstanding: number },
  overdue: number,
): Counts {
  return {
    assigned: totals.assigned,
    completed: totals.completed,
    missed: totals.missed,
    overdue,
    open: Math.max(0, totals.outstanding - overdue),
  };
}

function weekRange(from: string, to: string): string {
  return `${formatDateOnly(from, { weekday: false })} – ${formatDateOnly(to, { weekday: false })}`;
}

function Row({
  open,
  onToggle,
  title,
  subtitle,
  counts,
  level,
}: {
  open: boolean;
  onToggle: () => void;
  title: string;
  subtitle: string;
  counts: Counts;
  level: "week" | "day";
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-3 text-left hover:bg-accent/60 sm:px-4",
        level === "week" ? "font-semibold" : "text-sm",
      )}
    >
      <ChevronRight
        aria-hidden="true"
        className={cn(
          "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150",
          open && "rotate-90",
        )}
      />
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {subtitle ? (
        <span className="hidden shrink-0 text-xs font-normal text-muted-foreground sm:inline">
          {subtitle}
        </span>
      ) : null}

      {/* The counts are the point of a collapsed row: without them you have to
          open every week to find out which one is worth opening. */}
      <span className="flex shrink-0 items-center gap-1">
        {counts.overdue > 0 ? <Badge variant="warning">{counts.overdue} overdue</Badge> : null}
        {counts.missed > 0 ? <Badge variant="destructive">{counts.missed} missed</Badge> : null}
        {counts.open > 0 ? <Badge variant="muted">{counts.open} open</Badge> : null}
        {counts.assigned > 0 && counts.completed === counts.assigned ? (
          <Badge variant="success">all done</Badge>
        ) : null}
      </span>
    </button>
  );
}
