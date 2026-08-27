"use client";

import { useMemo, useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { InstanceStatus } from "@prisma/client";
import { ProgressRing } from "@/components/progress-ring";
import { useToast } from "@/components/ui/toast";
import type { MyDay, MyDayTask } from "@/lib/my-day";
import { formatDateOnly, formatDateOnlyLong, dayName, isoWeekday } from "@/lib/time";
import { TaskRow } from "./task-row";
import { Section } from "./section";

export function MyDayScreen({
  user,
  day,
  notice,
}: {
  user: { name: string };
  day: MyDay;
  notice: string | null;
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
    <main className="mx-auto w-full max-w-2xl px-4 pb-16 pt-5 safe-bottom">
      {notice ? (
        <p className="mb-4 rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">{notice}</p>
      ) : null}

      <header className="mb-6 flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-bold tracking-tight">
            {greeting()}, {firstName}
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
          <p className="font-medium text-success">That is your day cleared.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Nothing else is owed until tomorrow.
          </p>
        </div>
      ) : null}

      <div className="flex flex-col gap-6">
        <Section
          title="Overdue"
          tone="danger"
          count={sections.overdue.length}
          description="Still inside the catch-up window."
        >
          {sections.overdue.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              busy={pendingIds.has(task.id)}
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

        <Section title="Today" count={sections.dueToday.length}>
          {sections.dueToday.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              busy={pendingIds.has(task.id)}
              onToggle={(done, note) => setDone(task, done, note)}
              onSaveNote={(note) => saveNote(task, note)}
            />
          ))}
        </Section>

        <Section title="This week" tone="muted" count={sections.thisWeek.length}>
          {sections.thisWeek.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              muted
              busy={pendingIds.has(task.id)}
              onToggle={(done, note) => setDone(task, done, note)}
              onSaveNote={(note) => saveNote(task, note)}
              trailing={
                <span className="text-xs font-medium text-muted-foreground">
                  {dayName(isoWeekday(task.dueDate))}
                </span>
              }
            />
          ))}
        </Section>

        <Section title="This month" tone="muted" count={sections.thisMonth.length}>
          {sections.thisMonth.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              muted
              busy={pendingIds.has(task.id)}
              onToggle={(done, note) => setDone(task, done, note)}
              onSaveNote={(note) => saveNote(task, note)}
              trailing={
                <span className="text-xs font-medium text-muted-foreground">
                  {formatDateOnly(task.dueDate)}
                </span>
              }
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
              onToggle={(done, note) => setDone(task, done, note)}
              onSaveNote={(note) => saveNote(task, note)}
            />
          ))}
        </Section>
      </div>
    </main>
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
  return [...day.overdue, ...day.dueToday, ...day.thisWeek, ...day.thisMonth, ...day.doneToday];
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
    thisWeek: pick(day.thisWeek).filter((t) => t.status === InstanceStatus.PENDING),
    thisMonth: pick(day.thisMonth).filter((t) => t.status === InstanceStatus.PENDING),
    doneToday: [...owed, ...pick(day.thisWeek), ...pick(day.thisMonth)].filter(
      (t) => t.status === InstanceStatus.COMPLETED,
    ),
  };
}
