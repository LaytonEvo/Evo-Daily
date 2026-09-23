"use client";

import { rollUpByWeek } from "@/lib/reports";
import { WeekDrill } from "./week-drill";
import { InstanceRows, type HistoryRow } from "./history-table";

/**
 * Everything still owed or written off, by week and then by day.
 *
 * The two states are shown together on purpose. A task missed three weeks ago
 * and one open from yesterday are the same failure at different ages, and the
 * grace period is an implementation detail of the app rather than something a
 * manager should have to hold in their head to read this card.
 *
 * The rows are the ordinary instance rows, so the thing you do after finding
 * an unfinished task — ask about it, or write it off — happens here rather
 * than somewhere else you have to go and find.
 */
export function OutstandingList({
  rows,
  today,
  attachmentsEnabled,
}: {
  rows: HistoryRow[];
  today: string;
  attachmentsEnabled: boolean;
}) {
  const weeks = rollUpByWeek(rows, today);

  return (
    <WeekDrill
      weeks={weeks}
      emptyLabel="Nothing missed and nothing overdue in this window."
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
