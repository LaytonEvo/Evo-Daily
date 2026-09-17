"use client";

import { useState } from "react";
import { InstanceStatus } from "@prisma/client";
import { ChevronDown, MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CommentThread } from "@/app/my-day/comment-thread";
import { NotDoneButton } from "./not-done-button";
import { cn } from "@/lib/utils";
import { formatDateOnly, formatTimeLondon } from "@/lib/time";

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
export function HistoryTable({
  rows,
  attachmentsEnabled,
}: {
  rows: HistoryRow[];
  attachmentsEnabled: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm sm:min-w-[600px]">
        <thead className="border-y bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-2 py-2.5 font-medium sm:px-3">Due</th>
            <th className="px-2 py-2.5 font-medium sm:px-3">Task</th>
            <th className="px-2 py-2.5 font-medium sm:px-3">Status</th>
            <th className="hidden px-2 py-2.5 font-medium sm:table-cell sm:px-3">Completed</th>
            <th className="hidden px-2 py-2.5 font-medium md:table-cell md:px-3">Note</th>
            <th className="w-28 px-2 py-2.5 sm:px-3" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const expanded = open === row.id;
            return (
              <FragmentRow
                key={row.id}
                row={row}
                expanded={expanded}
                onToggle={() => setOpen(expanded ? null : row.id)}
                attachmentsEnabled={attachmentsEnabled}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FragmentRow({
  row,
  expanded,
  onToggle,
  attachmentsEnabled,
}: {
  row: HistoryRow;
  expanded: boolean;
  onToggle: () => void;
  attachmentsEnabled: boolean;
}) {
  const completed =
    row.completedAt instanceof Date ? row.completedAt : row.completedAt ? new Date(row.completedAt) : null;

  return (
    <>
      <tr className={cn("border-b last:border-0", expanded && "bg-accent/40")}>
        <td className="whitespace-nowrap px-2 py-2.5 text-muted-foreground sm:px-3">
          {formatDateOnly(row.dueDate)}
        </td>
        <td className="max-w-[40vw] px-2 py-2.5 font-medium sm:max-w-none sm:px-3">{row.title}</td>
        <td className="px-2 py-2.5 sm:px-3">
          <StatusBadge status={row.status} wasLate={row.wasLate} />
        </td>
        <td className="hidden whitespace-nowrap px-2 py-2.5 text-muted-foreground sm:table-cell sm:px-3">
          {completed
            ? `${formatDateOnly(completed.toISOString().slice(0, 10))} ${formatTimeLondon(completed)}`
            : "—"}
        </td>
        <td className="hidden max-w-[220px] truncate px-2 py-2.5 text-muted-foreground md:table-cell md:px-3">
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
          <td colSpan={6} className="px-3 pb-4 pt-0 sm:px-4">
            <CommentThread instanceId={row.id} attachmentsEnabled={attachmentsEnabled} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function StatusBadge({ status, wasLate }: { status: InstanceStatus; wasLate: boolean }) {
  if (status === InstanceStatus.COMPLETED) {
    return wasLate ? (
      <Badge variant="warning">Completed late</Badge>
    ) : (
      <Badge variant="success">Completed</Badge>
    );
  }
  if (status === InstanceStatus.MISSED) return <Badge variant="destructive">Missed</Badge>;
  return <Badge variant="muted">Open</Badge>;
}
