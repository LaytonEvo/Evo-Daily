"use client";

import { useMemo, useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { InstanceStatus } from "@prisma/client";
import { ProgressRing } from "@/components/progress-ring";
import { useToast } from "@/components/ui/toast";
import type { MyDay, MyDayTask } from "@/lib/my-day";
import { formatDateOnlyLong } from "@/lib/time";
import { cn } from "@/lib/utils";
import { TaskRow } from "./task-row";
import { Section } from "./section";
import { DayPlan } from "./day-plan";

export function MyDayScreen({
  user,
  day,
  notice,
  attachmentsEnabled,
  readOnly = false,
}: {
  user: { name: string };
  day: MyDay;
  notice: string | null;
  attachmentsEnabled: boolean;
  /**
   * An admin looking at somebody else's day. Same screen, same sections, same
   * ordering — that is the point, and rebuilding a second read-only version of
   * it would be a copy that drifts.
   */
  readOnly?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [, startTransition] = useTransition();

  // Completion is optimistic: the tick lands instantly and the server confirms
  // behind it. A failure reverts the row and says so.
  const [tasks, applyOptimistic] = useOptimistic(
    collectTasks(day),
    (current: MyDayTask[], change: { id: string; status: InstanceStatus }) =>
      current.map((task) =>
        task.id === change.id ? { ...task, status: change.status } : task,
      ),
  );

  const sections = useMemo(() => splitIntoSections(tasks, day), [tasks, day]);
  const owedDone = sections.doneToday.length;
  const owedTotal = sections.overdue.length + sections.dueToday.length + owedDone;
  const allClear = owedTotal > 0 && owedDone === owedTotal;

  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  // Overdue work lives behind its own tab. Today's list stays the clean thing
  // you open in the morning; the backlog is one tap away, not in the way.
  const [tab, setTab] = useState<"today" | "overdue">("today");

  function markPending(id: string, on: boolean) {
    setPendingIds((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function setDone(task: MyDayTask, done: boolean, note?: string | null) {
    const nextStatus = done ? InstanceStatus.COMPLETED : InstanceStatus.PENDING;

    markPending(task.id, true);
    startTransition(async () => {
      applyOptimistic({ id: task.id, status: nextStatus });

      try {
        const response = await fetch(`/api/instances/${task.id}/complete`, {
          method: done ? "POST" : "DELETE",
          headers: { "content-type": "application/json" },
          ...(done ? { body: JSON.stringify({ note: note ?? undefined }) } : {}),
        });

        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error ?? "Could not save that.");
        }

        if (done) {
          toast(`${task.title} — done`, {
            action: { label: "Undo", onClick: () => void setDone(task, false) },
          });
        }
        router.refresh();
      } catch (error) {
        toast(error instanceof Error ? error.message : "Could not save that.", {
          tone: "error",
        });
        router.refresh();
      } finally {
        markPending(task.id, false);
      }
    });
  }

  async function saveNote(task: MyDayTask, note: string | null) {
    const response = await fetch(`/api/instances/${task.id}/note`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note }),
    });
    if (!response.ok) {
      toast("Could not save that note.", { tone: "error" });
      return;
    }
    router.refresh();
  }

  const firstName = user.name.split(" ")[0] || user.name;

  return (
    <main className="mx-auto w-full max-w-2xl pb-16 pt-2 safe-bottom">
      {notice ? (
        <p className="mb-4 rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">{notice}</p>
      ) : null}

      <header className="mb-4 flex items-center gap-4 sm:mb-6">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-bold tracking-tight">
            {readOnly ? `${firstName}'s day` : `${greeting()}, ${firstName}`}
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {formatDateOnlyLong(day.today)}
          </p>
          <p className="mt-1 text-sm font-medium">
            {owedTotal === 0
              ? "Nothing due today."
              : allClear
                ? "All done for today."
                : `${owedDone} of ${owedTotal} done`}
          </p>
        </div>
        <ProgressRing done={owedDone} total={owedTotal} />
      </header>

      {allClear ? (
        <div className="mb-6 rounded-lg border border-success/30 bg-success/5 p-4 text-center animate-fade-in">
          <p className="font-medium text-success">
            {readOnly ? `${firstName}'s day is cleared.` : "That is your day cleared."}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Nothing else is owed until tomorrow.
          </p>
        </div>
      ) : null}

      {sections.overdue.length > 0 ? (
        <div className="sticky top-16 z-20 -mx-4 mb-4 bg-background px-4 pb-2 pt-1 sm:static sm:mx-0 sm:px-0 sm:pb-0 sm:pt-0">
          <div
            role="tablist"
            aria-label="Which tasks to show"
            className="flex gap-1 rounded-xl bg-muted p-1"
          >
            <TabButton
              selected={tab === "today"}
              onClick={() => setTab("today")}
              label="Today"
              count={sections.dueToday.length}
            />
            <TabButton
              selected={tab === "overdue"}
              onClick={() => setTab("overdue")}
              label="Overdue"
              count={sections.overdue.length}
              tone="danger"
            />
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-6">
        {tab === "overdue" ? (
          <Section
            title="Overdue"
            tone="danger"
            count={sections.overdue.length}
            description="Still inside the catch-up window. Ticking one off needs a reason."
          >
            {sections.overdue.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                busy={pendingIds.has(task.id)}
                attachmentsEnabled={attachmentsEnabled}
                readOnly={readOnly}
                requiresReason
                onToggle={(done, note) => setDone(task, done, note)}
                onSaveNote={(note) => saveNote(task, note)}
                trailing={
                  <span className="text-xs font-medium text-destructive">
                    {task.daysLate === 1 ? "1 day late" : `${task.daysLate} days late`}
                  </span>
                }
              />
            ))}
          </Section>
        ) : (
          <>
            {sections.dueToday.length === 0 && !allClear ? (
              <div className="rounded-lg border border-dashed bg-card/50 px-4 py-8 text-center">
                <p className="text-sm font-medium">Nothing due today.</p>
                {sections.overdue.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setTab("overdue")}
                    className="mt-1 inline-flex h-10 items-center px-2 text-sm font-medium text-destructive underline underline-offset-4"
                  >
                    {sections.overdue.length === 1
                      ? "1 overdue task to catch up on"
                      : `${sections.overdue.length} overdue tasks to catch up on`}
                  </button>
                ) : null}
              </div>
            ) : null}

            <Section title="Today" count={sections.dueToday.length}>
              {sections.dueToday.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  busy={pendingIds.has(task.id)}
                  attachmentsEnabled={attachmentsEnabled}
                  readOnly={readOnly}
                  onToggle={(done, note) => setDone(task, done, note)}
                  onSaveNote={(note) => saveNote(task, note)}
                />
              ))}
            </Section>

            <Section
              title="Done today"
              tone="success"
              count={sections.doneToday.length}
              collapsedByDefault
            >
              {sections.doneToday.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  busy={pendingIds.has(task.id)}
                  attachmentsEnabled={attachmentsEnabled}
                  readOnly={readOnly}
                  onToggle={(done, note) => setDone(task, done, note)}
                  onSaveNote={(note) => saveNote(task, note)}
                />
              ))}
            </Section>

            {/* Today only. An overdue task belongs to a day that has already
                been and gone, so it has no place on this one's clock. */}
            <DayPlan tasks={[...sections.dueToday, ...sections.doneToday]} today={day.today} />
          </>
        )}
      </div>

    </main>
  );
}

function TabButton({
  selected,
  onClick,
  label,
  count,
  tone = "default",
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
  count: number;
  tone?: "default" | "danger";
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors",
        selected ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground",
        selected && tone === "danger" && "text-destructive",
      )}
    >
      {label}
      <span
        className={cn(
          "rounded-full px-1.5 py-0.5 text-xs tabular-nums",
          tone === "danger" ? "bg-destructive/10 text-destructive" : "bg-muted-foreground/10",
        )}
      >
        {count}
      </span>
    </button>
  );
}

function greeting(now: Date = new Date()): string {
  // Deliberately not timezone-aware to the minute — this is a pleasantry, not
  // a due date, and it is computed on the client where the member is standing.
  const hour = now.getHours();
  if (hour < 12) return "Morning";
  if (hour < 18) return "Afternoon";
  return "Evening";
}

function collectTasks(day: MyDay): MyDayTask[] {
  return [...day.overdue, ...day.dueToday, ...day.doneToday];
}

/**
 * Re-split the flat list after an optimistic change, so a ticked task moves to
 * "Done today" without waiting for the server.
 */
function splitIntoSections(tasks: MyDayTask[], day: MyDay) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const pick = (source: MyDayTask[]) =>
    source.map((t) => byId.get(t.id) ?? t);

  const originalOpen = pick([...day.overdue, ...day.dueToday]);
  const originalDone = pick(day.doneToday);
  const owed = [...originalOpen, ...originalDone];

  return {
    overdue: owed.filter(
      (t) => t.status === InstanceStatus.PENDING && t.dueDate < day.today,
    ),
    dueToday: owed.filter(
      (t) => t.status === InstanceStatus.PENDING && t.dueDate === day.today,
    ),
    doneToday: owed.filter((t) => t.status === InstanceStatus.COMPLETED),
  };
}
