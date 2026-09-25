"use client";

import { useMemo, useState } from "react";
import { InstanceStatus } from "@prisma/client";
import { ChevronDown, MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CommentThread } from "@/app/my-day/comment-thread";
import { NotDoneButton } from "./not-done-button";
import { cn } from "@/lib/utils";
import { daysBetween, formatDateOnly, formatTimeLondon } from "@/lib/time";
import { isOverdueRow, rollUpByWeek } from "@/lib/reports";
import { WeekDrill } from "./week-drill";

export type HistoryRow = {
  id: string;
  title: string;
  dueDate: string;
  status: InstanceStatus;
  wasLate: boolean;
  completedAt: Date | string | null;
  note: string | null;
  commentCount: number;
};

/**
 * One person's instances, each row openable.
 *
 * The thread is the same component members use, so an admin reads exactly what
 * the assignee wrote and can answer in the same place. It mounts only when a
 * row is opened — a window can be hundreds of rows and a request each would be
 * absurd.
 */
export type HistoryFilter = "all" | "completed" | "late" | "missed" | "open";

export function matchesFilter(row: HistoryRow, filter: HistoryFilter): boolean {
  if (filter === "all") return true;
  if (filter === "missed") return row.status === InstanceStatus.MISSED;
  if (filter === "completed") return row.status === InstanceStatus.COMPLETED;
  // Everything still owed: not done, not written off. The grace window has not
  // closed on these, which is exactly why they are worth a filter of their own
  // — they are the only ones anybody can still do anything about.
  if (filter === "open") return row.status === InstanceStatus.PENDING;
  // "late" is a completed task that missed its cut-off, not a separate status.
  return row.status === InstanceStatus.COMPLETED && row.wasLate;
}

export function HistoryTable({
  rows,
  attachmentsEnabled,
  filter = "all",
  onClearFilter,
  today,
}: {
  rows: HistoryRow[];
  attachmentsEnabled: boolean;
  filter?: HistoryFilter;
  onClearFilter?: () => void;
  /** Supplied so "overdue" is decided in London, not in the reader's browser. */
  today?: string;
}) {
  const shown = rows.filter((r) => matchesFilter(r, filter));

  const weeks = useMemo(
    () => (today ? rollUpByWeek(shown, today) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shown.map((r) => r.id).join(","), today],
  );

  if (shown.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-muted-foreground">
        Nothing matches that.{" "}
        {onClearFilter ? (
          <button type="button" onClick={onClearFilter} className="underline">
            Show everything
          </button>
        ) : null}
      </p>
    );
  }

  if (today) {
    return (
      <WeekDrill
        weeks={weeks}
        emptyLabel="Nothing in this window."
        renderRows={(dayRows) => (
          <InstanceRows
            rows={dayRows}
            attachmentsEnabled={attachmentsEnabled}
            today={today}
            showDue={false}
          />
        )}
      />
    );
  }

  return <InstanceRows rows={shown} attachmentsEnabled={attachmentsEnabled} today={today} />;
}

/**
 * The rows themselves — a card list on a phone, a table above it.
 *
 * Exported because every list of instances on this page is the same list: the
 * chart's day panel, the missed-and-overdue card, the history. They differed
 * only in being read-only, which is exactly the thing that made the report
 * somewhere you looked rather than somewhere you worked. One component, so a
 * row can be opened, commented on and written off wherever it appears.
 */
export function InstanceRows({
  rows: shown,
  attachmentsEnabled,
  today,
  showDue = true,
}: {
  rows: HistoryRow[];
  attachmentsEnabled: boolean;
  /** Supplied so an open row can say how late it is, not just that it is open. */
  today?: string;
  /** Off where the day is already the heading above the rows. */
  showDue?: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <>
      {/* A phone cannot hold five columns without breaking titles onto one
          word per line, so below sm each row becomes a card instead. */}
      <ul className="flex flex-col gap-2 px-3 sm:hidden">
        {shown.map((row) => (
          <HistoryCard
            key={row.id}
            row={row}
            expanded={open === row.id}
            onToggle={() => setOpen(open === row.id ? null : row.id)}
            attachmentsEnabled={attachmentsEnabled}
            today={today}
          />
        ))}
      </ul>

      <div className="hidden overflow-x-auto sm:block">
      <table className="w-full text-sm">
        <thead className="border-y bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            {showDue ? <th className="px-2 py-2.5 font-medium sm:px-3">Due</th> : null}
            <th className="px-2 py-2.5 font-medium sm:px-3">Task</th>
            <th className="px-2 py-2.5 font-medium sm:px-3">Status</th>
            <th className="hidden px-2 py-2.5 font-medium sm:table-cell sm:px-3">Completed</th>
            <th className="hidden px-2 py-2.5 font-medium md:table-cell md:px-3">Note</th>
            <th className="w-28 px-2 py-2.5 sm:px-3" />
          </tr>
        </thead>
        <tbody>
          {shown.map((row) => {
            const expanded = open === row.id;
            return (
              <FragmentRow
                key={row.id}
                row={row}
                expanded={expanded}
                onToggle={() => setOpen(expanded ? null : row.id)}
                attachmentsEnabled={attachmentsEnabled}
                today={today}
                showDue={showDue}
              />
            );
          })}
        </tbody>
      </table>
      </div>
    </>
  );
}

/** One instance on a phone. The same actions, stacked rather than columned. */
function HistoryCard({
  row,
  expanded,
  onToggle,
  attachmentsEnabled,
  today,
}: {
  row: HistoryRow;
  expanded: boolean;
  onToggle: () => void;
  attachmentsEnabled: boolean;
  today?: string;
}) {
  const completed =
    row.completedAt instanceof Date
      ? row.completedAt
      : row.completedAt
        ? new Date(row.completedAt)
        : null;

  return (
    <li className="rounded-xl border bg-card">
      <div className="flex flex-col gap-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 flex-1 text-sm font-semibold leading-snug">{row.title}</p>
          <StatusBadge row={row} today={today} />
        </div>

        <p className="text-xs text-muted-foreground">
          Due {formatDateOnly(row.dueDate)}
          {completed
            ? ` · done ${formatDateOnly(completed.toISOString().slice(0, 10))} ${formatTimeLondon(completed)}`
            : ""}
        </p>

        {row.note ? (
          <p className="rounded-lg bg-muted/60 px-2 py-1.5 text-xs text-muted-foreground">
            {row.note}
          </p>
        ) : null}

        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={expanded ? `Hide comments on ${row.title}` : `Show comments on ${row.title}`}
            onClick={onToggle}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-muted px-3 text-xs font-medium text-muted-foreground"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            {row.commentCount > 0 ? row.commentCount : "Comment"}
            <ChevronDown
              className={cn("h-4 w-4 transition-transform duration-150", expanded && "rotate-180")}
            />
          </button>
          <span className="ml-auto">
            <NotDoneButton instanceId={row.id} title={row.title} status={row.status} />
          </span>
        </div>
      </div>

      {expanded ? (
        <div className="border-t px-3 pb-3">
          <CommentThread instanceId={row.id} attachmentsEnabled={attachmentsEnabled} />
        </div>
      ) : null}
    </li>
  );
}

function FragmentRow({
  row,
  expanded,
  onToggle,
  attachmentsEnabled,
  today,
  showDue = true,
}: {
  row: HistoryRow;
  expanded: boolean;
  onToggle: () => void;
  attachmentsEnabled: boolean;
  today?: string;
  showDue?: boolean;
}) {
  const completed =
    row.completedAt instanceof Date ? row.completedAt : row.completedAt ? new Date(row.completedAt) : null;

  return (
    <>
      <tr className={cn("border-b last:border-0", expanded && "bg-accent/40")}>
        {showDue ? (
          <td className="whitespace-nowrap px-2 py-2.5 text-muted-foreground sm:px-3">
            {formatDateOnly(row.dueDate)}
          </td>
        ) : null}
        <td className="max-w-[40vw] px-2 py-2.5 font-medium sm:max-w-none sm:px-3">{row.title}</td>
        <td className="px-2 py-2.5 sm:px-3">
          <StatusBadge row={row} today={today} />
        </td>
        <td className="hidden whitespace-nowrap px-2 py-2.5 text-muted-foreground sm:table-cell sm:px-3">
          {completed
            ? `${formatDateOnly(completed.toISOString().slice(0, 10))} ${formatTimeLondon(completed)}`
            : "—"}
        </td>
        <td
          title={row.note ?? undefined}
          className="hidden max-w-[220px] truncate px-2 py-2.5 text-muted-foreground md:table-cell md:px-3"
        >
          {row.note ?? ""}
        </td>
        <td className="px-2 py-2.5 text-right sm:px-3">
          <div className="flex items-center justify-end gap-1">
            <NotDoneButton instanceId={row.id} title={row.title} status={row.status} />
            <button
              type="button"
              aria-expanded={expanded}
              aria-label={expanded ? `Hide comments on ${row.title}` : `Show comments on ${row.title}`}
              onClick={onToggle}
              className="flex h-9 items-center gap-1 rounded-lg px-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              {row.commentCount > 0 ? (
                <>
                  <MessageSquare className="h-3.5 w-3.5" />
                  <span className="text-xs tabular-nums">{row.commentCount}</span>
                </>
              ) : null}
              <ChevronDown
                className={cn("h-4 w-4 transition-transform duration-150", expanded && "rotate-180")}
              />
            </button>
          </div>
        </td>
      </tr>

      {expanded ? (
        <tr className="border-b bg-accent/20 last:border-0">
          <td colSpan={showDue ? 6 : 5} className="px-3 pb-4 pt-0 sm:px-4">
            {row.note ? <FullNote note={row.note} /> : null}
            <CommentThread instanceId={row.id} attachmentsEnabled={attachmentsEnabled} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

/**
 * What somebody wrote when they ticked the task off, or wrote it off.
 *
 * The cell in the row above is one truncated line, because a table of a
 * month's work has to stay scannable. That left the rest of the sentence
 * nowhere to go on a desktop screen: the phone layout printed the note in
 * full, the table clipped it at 220 pixels, and opening the row showed the
 * comments and not the note. People were writing paragraphs nobody could read.
 */
function FullNote({ note }: { note: string }) {
  return (
    <div className="pt-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Note</p>
      <p className="mt-0.5 whitespace-pre-wrap text-sm leading-snug">{note}</p>
    </div>
  );
}

function StatusBadge({ row, today }: { row: HistoryRow; today?: string }) {
  if (row.status === InstanceStatus.COMPLETED) {
    return row.wasLate ? (
      <Badge variant="warning">Completed late</Badge>
    ) : (
      <Badge variant="success">Completed</Badge>
    );
  }
  if (row.status === InstanceStatus.MISSED) return <Badge variant="destructive">Missed</Badge>;

  // An open task from last Tuesday and an open task from this morning are not
  // the same news, and "Open" says the same thing about both.
  if (today && isOverdueRow(row, today)) {
    const late = daysBetween(row.dueDate, today);
    return <Badge variant="warning">{late === 1 ? "1 day late" : `${late} days late`}</Badge>;
  }
  return <Badge variant="muted">Open</Badge>;
}
