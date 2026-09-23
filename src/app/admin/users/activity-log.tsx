import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  daysBetween,
  eachDateInRange,
  addDays,
  formatDateOnly,
  formatDateOnlyLong,
  formatTimeLondon,
  toDateOnly,
  type DateOnly,
} from "@/lib/time";
import { cn } from "@/lib/utils";

type Row = {
  id: string;
  name: string;
  isActive: boolean;
  lastActiveAt: string | null;
  days: { day: string; visits: number }[];
};

/**
 * Who is actually opening it.
 *
 * The sign-in log below answers a different question, and for a long time it
 * was the only one on the page: a session lasts a month, so somebody who logs
 * in once and uses it every morning appears there exactly once and then seems
 * to have stopped. This is page loads, rolled up per day.
 *
 * A strip of days rather than a count, because four days running and four days
 * scattered over a fortnight are not the same news and one number cannot tell
 * them apart.
 */
export function ActivityLog({
  rows,
  today,
  days,
}: {
  rows: Row[];
  today: DateOnly;
  days: number;
}) {
  const window = eachDateInRange(addDays(today, -(days - 1)), today);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Who is using it</CardTitle>
        <CardDescription>
          Days each person opened the app, over the last {days}. Counted on every page they
          load, not on signing in — a session lasts a month, so signing in says nothing about
          whether somebody came back.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y">
          {rows.map((row) => {
            const visited = new Map(row.days.map((d) => [d.day, d.visits]));
            const activeDays = row.days.length;

            return (
              <li
                key={row.id}
                className={cn(
                  "flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-3",
                  !row.isActive && "opacity-60",
                )}
              >
                <div className="min-w-0 sm:w-44 sm:shrink-0">
                  <p className="truncate text-sm font-medium">{row.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {lastActiveLabel(row.lastActiveAt, today)}
                  </p>
                </div>

                {/* Oldest on the left, so it reads the way a calendar does. */}
                <div className="flex flex-1 items-center gap-[3px]">
                  {window.map((day) => {
                    const visits = visited.get(day) ?? 0;
                    return (
                      <span
                        key={day}
                        title={
                          visits > 0
                            ? `${formatDateOnlyLong(day)} — ${visits} visit${visits === 1 ? "" : "s"}`
                            : `${formatDateOnlyLong(day)} — not opened`
                        }
                        className={cn(
                          "h-5 flex-1 rounded-sm",
                          visits === 0
                            ? "bg-muted"
                            : visits < 3
                              ? "bg-success/40"
                              : "bg-success",
                        )}
                      />
                    );
                  })}
                </div>

                <div className="shrink-0 sm:w-24 sm:text-right">
                  {activeDays === 0 ? (
                    <Badge variant="muted">never</Badge>
                  ) : (
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {activeDays} of {days} days
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

/** "Today 09:14", "Yesterday", "4 days ago", "12 Sep", or never. */
function lastActiveLabel(iso: string | null, today: DateOnly): string {
  if (!iso) return "Never opened it";
  const at = new Date(iso);
  const day = toDateOnly(at);
  if (day === today) return `Today ${formatTimeLondon(at)}`;
  const ago = daysBetween(day, today);
  if (ago === 1) return `Yesterday ${formatTimeLondon(at)}`;
  if (ago < 7) return `${ago} days ago`;
  return formatDateOnly(day);
}
