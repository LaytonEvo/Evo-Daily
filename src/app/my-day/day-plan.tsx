"use client";

import { useEffect, useState } from "react";
import { InstanceStatus } from "@prisma/client";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { hourOf, layOutDay, minuteOf } from "@/lib/day-plan";
import { timeNowInLondon, type DateOnly } from "@/lib/time";
import type { MyDayTask } from "@/lib/my-day";

/**
 * Today laid out by the clock.
 *
 * The list above says what is owed, and is already in time order; nineteen
 * rows of it still read as a pile. This says *when*, which is the difference
 * between a checklist and a plan you can work down — which was the ask.
 *
 * Only a task with a cut-off time can be placed. The rest sit in one band
 * underneath rather than being given an invented hour: a made-up time on a
 * calendar is worse than no time at all, because it looks like a commitment.
 *
 * The layout rules live in lib/day-plan.ts, where they can be tested without
 * rendering anything.
 */
export function DayPlan({ tasks, today }: { tasks: MyDayTask[]; today: DateOnly }) {
  const [now, setNow] = useState<string | null>(null);

  // London, not the browser's timezone: every cut-off on this page is London
  // wall-clock, and a "now" line an hour out from the times beside it is worse
  // than no line at all. Read after mount rather than during render — the
  // server cannot know what minute the browser will paint, and guessing is a
  // hydration error.
  useEffect(() => {
    const read = () => setNow(timeNowInLondon());
    read();
    const timer = setInterval(read, 60_000);
    return () => clearInterval(timer);
  }, []);

  const { hours, byHour, untimed } = layOutDay(tasks, today);
  if (hours.length === 0) return null;

  return (
    <section>
      <div className="py-1">
        <h2 className="text-sm font-semibold uppercase tracking-wide">Your day</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Work down it. Anything without a cut-off time is underneath.
        </p>
      </div>

      <ol className="mt-2 overflow-hidden rounded-lg border bg-card">
        {hours.map((hour) => {
          const inHour = byHour.get(hour) ?? [];
          const isNow = now !== null && hourOf(now) === hour;

          return (
            <li
              key={hour}
              className={cn(
                "relative flex gap-3 border-b px-3 py-1.5 last:border-0",
                inHour.length === 0 && "min-h-[2.25rem]",
              )}
            >
              <span className="w-11 shrink-0 pt-1 text-xs tabular-nums text-muted-foreground">
                {String(hour).padStart(2, "0")}:00
              </span>

              <div className="flex min-w-0 flex-1 flex-col gap-1">
                {inHour.map((task) => (
                  <Block key={task.id} task={task} />
                ))}
              </div>

              {isNow && now ? (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 h-px bg-destructive"
                  style={{ top: `${(minuteOf(now) / 60) * 100}%` }}
                >
                  <span className="absolute left-0 top-[-3px] h-[7px] w-[7px] rounded-full bg-destructive" />
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>

      {untimed.length > 0 ? (
        <div className="mt-3">
          <p className="text-xs font-medium text-muted-foreground">
            Any time today ({untimed.length})
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {untimed.map((task) => (
              <li
                key={task.id}
                className={cn(
                  "max-w-full truncate rounded-lg bg-muted px-2 py-1 text-xs",
                  task.status === InstanceStatus.COMPLETED &&
                    "text-muted-foreground line-through",
                )}
              >
                {task.title}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function Block({ task }: { task: MyDayTask }) {
  const done = task.status === InstanceStatus.COMPLETED;
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border-l-2 px-2 py-1 text-xs",
        done ? "bg-success/10 text-muted-foreground" : "bg-primary/5",
      )}
      // The colour the row above carries, so the two read as one thing.
      style={{
        borderLeftColor: done
          ? "hsl(var(--success))"
          : (task.categoryColour ?? "hsl(var(--primary))"),
      }}
    >
      {done ? <Check className="h-3 w-3 shrink-0 text-success" strokeWidth={3} /> : null}
      <span className={cn("truncate font-medium", done && "line-through")}>{task.title}</span>
      {/* The hour is already down the left. Only a task landing part-way
          through one has anything left to say. */}
      {task.dueTimeLabel?.endsWith(":00") ? null : (
        <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
          {task.dueTimeLabel}
        </span>
      )}
    </div>
  );
}
