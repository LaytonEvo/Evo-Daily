"use client";

import { InstanceStatus } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { isOverdueRow, rollUpByWeek } from "@/lib/reports";
import { daysBetween } from "@/lib/time";
import { WeekDrill } from "./week-drill";
import type { HistoryRow } from "./history-table";

/**
 * Everything still owed or written off, by week and then by day.
 *
 * The two states are shown together on purpose. A task missed three weeks ago
 * and one open from yesterday are the same failure at different ages, and the
 * grace period is an implementation detail of the app rather than something a
 * manager should have to hold in their head to read this card. The badge says
 * which is which, and the overdue ones carry how late they are, because "two
 * days" and "eleven days" are different conversations.
 */
export function OutstandingList({ rows, today }: { rows: HistoryRow[]; today: string }) {
  const weeks = rollUpByWeek(rows, today);

  return (
    <WeekDrill
      weeks={weeks}
      emptyLabel="Nothing missed and nothing overdue in this window."
      renderRows={(dayRows) => (
        <ul className="flex flex-col divide-y">
          {dayRows.map((row) => {
            const overdue = isOverdueRow(row, today);
            const late = daysBetween(row.dueDate, today);
            return (
              <li
                key={row.id}
                className="flex flex-col gap-1 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3 sm:px-4"
              >
                {/* Stacked on a phone: side by side, the title truncates to a
                    couple of words and stops being identifiable. */}
                <span className="min-w-0 text-sm font-medium sm:flex-1 sm:truncate">
                  {row.title}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {overdue ? (
                    <Badge variant="warning">
                      {late === 1 ? "1 day late" : `${late} days late`}
                    </Badge>
                  ) : row.status === InstanceStatus.MISSED ? (
                    <Badge variant="destructive">Missed</Badge>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    />
  );
}
