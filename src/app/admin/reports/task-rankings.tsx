"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RANKING_SIZE, type RankingOption, type TaskTally, type TaskRankings } from "@/lib/reports";
import { formatRate } from "@/lib/utils";
import { cn } from "@/lib/utils";

/**
 * What the team gets done, and what it drops.
 *
 * Counts rather than rates, which is what makes this a different question from
 * "Problem tasks" below it. That panel finds the worst rate; this one finds
 * the biggest hole. A daily job missed eleven times at 70% costs more than a
 * monthly one missed twice at 0%, and only a count says so.
 *
 * The completed side is not a congratulation. Read against the missed side it
 * says what the team reaches for when the day is short — which is the thing a
 * rota argument usually turns on and nothing else here shows.
 */
export function TaskRankingsPanel({ rankings }: { rankings: TaskRankings }) {
  const narrowed = Boolean(rankings.filters.assigneeId || rankings.filters.categoryId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>What gets done, and what gets dropped</CardTitle>
        <CardDescription>
          The tasks that came up most often on each side over this range, by count. Not the same
          question as the worst completion rate below — a daily job missed eleven times matters
          more than a monthly one missed twice, and only counting says so.
        </CardDescription>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Narrow
            param="rankBy"
            label="Person"
            allLabel="Everyone"
            options={rankings.people}
            value={rankings.filters.assigneeId ?? ""}
          />
          <Narrow
            param="rankCat"
            label="Category"
            allLabel="All categories"
            options={rankings.categoriesAvailable}
            value={rankings.filters.categoryId ?? ""}
          />
        </div>
      </CardHeader>

      <CardContent>
        <div className="grid gap-6 md:grid-cols-2">
          <Ranking
            title="Most missed"
            tone="missed"
            rows={rankings.missed}
            total={rankings.missedTasks}
            // Narrowed, "nothing was missed" would read as a clean sheet for
            // the whole team when it is a statement about one person.
            empty={narrowed ? "Nothing missed by this filter." : "Nothing was missed in this range."}
          />
          <Ranking
            title="Most completed"
            tone="completed"
            rows={rankings.completed}
            total={rankings.completedTasks}
            empty={
              narrowed ? "Nothing completed by this filter." : "Nothing was completed in this range."
            }
          />
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * One filter, held in the URL.
 *
 * In the URL rather than in component state so a narrowed view is a link —
 * the whole point of finding that one person drops the same job every week is
 * being able to send somebody the screen that shows it. It also survives the
 * reload that follows every window change.
 *
 * Only the rankings narrow. The tiles and the leaderboard above keep showing
 * the whole team, so the page never half-agrees with itself.
 */
function Narrow({
  param,
  label,
  allLabel,
  options,
  value,
}: {
  param: string;
  label: string;
  allLabel: string;
  options: RankingOption[];
  value: string;
}) {
  const router = useRouter();
  const params = useSearchParams();

  if (options.length < 2) return null;

  function pick(next: string) {
    const query = new URLSearchParams(params.toString());
    if (next) query.set(param, next);
    else query.delete(param);
    router.push(`/admin/reports?${query.toString()}`);
  }

  return (
    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="sr-only sm:not-sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => pick(e.target.value)}
        aria-label={label}
        className="h-9 rounded-lg border border-input bg-card px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function Ranking({
  title,
  tone,
  rows,
  total,
  empty,
}: {
  title: string;
  tone: "missed" | "completed";
  rows: TaskTally[];
  total: number;
  empty: string;
}) {
  // Bars are read against the top row of their own list, not across the two:
  // the question each answers is "which of these is worst", and a shared scale
  // would flatten the missed column to slivers on any team that mostly copes.
  const top = rows[0]?.count ?? 0;
  const Icon = tone === "missed" ? XCircle : CheckCircle2;

  return (
    <section>
      <h3 className="flex items-center gap-1.5 text-sm font-bold">
        {/* The status colour never carries the meaning on its own. */}
        <Icon
          aria-hidden="true"
          className={cn("h-4 w-4", tone === "missed" ? "text-destructive" : "text-success")}
        />
        {title}
        {total > rows.length ? (
          <span className="ml-1 text-xs font-normal text-muted-foreground">
            top {RANKING_SIZE} of {total}
          </span>
        ) : null}
      </h3>

      {rows.length === 0 ? (
        <p className="mt-3 text-sm italic text-muted-foreground">{empty}</p>
      ) : (
        <ol className="mt-2 flex flex-col">
          {rows.map((row) => (
            <li key={row.templateId} className="border-b py-2 last:border-0">
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 text-sm leading-snug">
                  {row.title}
                  {!row.isActive ? (
                    <Badge variant="muted" className="ml-2">
                      inactive
                    </Badge>
                  ) : null}
                </span>
                <span className="shrink-0 text-sm font-bold tabular-nums">{row.count}</span>
              </div>

              <div className="mt-1 flex items-center gap-2">
                <span
                  className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
                  role="presentation"
                >
                  <span
                    className={cn(
                      "block h-full rounded-full",
                      tone === "missed" ? "bg-destructive" : "bg-success",
                    )}
                    style={{ width: `${top === 0 ? 0 : (row.count / top) * 100}%` }}
                  />
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {/* Beside the count, because the count alone cannot tell a
                      task missed 4 of 4 times from one missed 4 of 40. */}
                  {row.count} of {row.assigned} due
                  {row.share === null ? "" : ` · ${formatRate(row.share)}`}
                </span>
              </div>

              <p className="truncate text-xs text-muted-foreground">
                {row.assigneeName}
                {row.categoryName ? ` · ${row.categoryName}` : ""}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
