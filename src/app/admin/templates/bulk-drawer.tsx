"use client";

import { useEffect, useState } from "react";
import { Frequency } from "@prisma/client";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { Category, Person } from "./templates-screen";

const WEEKDAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 7, label: "Sun" },
];

/** Which fields this edit is actually changing. */
type Field =
  | "assigneeId"
  | "categoryId"
  | "frequency"
  | "dueTime"
  | "startDate"
  | "endDate"
  | "isActive";

/**
 * Change one thing across many tasks.
 *
 * Every field is opt-in. A bulk form that posts whatever its inputs happen to
 * be showing would overwrite six fields to fix one, and on nineteen tasks at
 * once that is not a mistake anybody can undo from the list afterwards — so
 * nothing is sent unless its box is ticked, and the button says how many tasks
 * and how many fields are about to move.
 */
export function BulkDrawer({
  templateIds,
  users,
  categories,
  onClose,
  onSaved,
}: {
  templateIds: string[];
  users: Person[];
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const count = templateIds.length;
  const [on, setOn] = useState<Set<Field>>(new Set());
  const [busy, setBusy] = useState(false);

  const [assigneeId, setAssigneeId] = useState(users.find((u) => u.isActive)?.id ?? "");
  const [categoryId, setCategoryId] = useState("");
  const [frequency, setFrequency] = useState<Frequency>(Frequency.DAILY);
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([1, 2, 3, 4, 5]);
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [dueTime, setDueTime] = useState("");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState("");
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function toggle(field: Field) {
    setOn((current) => {
      const next = new Set(current);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  }

  function buildChanges(): Record<string, unknown> {
    const changes: Record<string, unknown> = {};
    if (on.has("assigneeId")) changes.assigneeId = assigneeId;
    // "" is the No category option, and clearing is a real choice here.
    if (on.has("categoryId")) changes.categoryId = categoryId || null;
    if (on.has("frequency")) {
      changes.frequency = frequency;
      if (frequency === Frequency.DAILY) changes.daysOfWeek = daysOfWeek;
      if (frequency === Frequency.WEEKLY) changes.dayOfWeek = dayOfWeek;
      if (frequency === Frequency.MONTHLY) changes.dayOfMonth = dayOfMonth;
    }
    if (on.has("dueTime")) changes.dueTime = dueTime || null;
    if (on.has("startDate")) changes.startDate = startDate;
    if (on.has("endDate")) changes.endDate = endDate || null;
    if (on.has("isActive")) changes.isActive = isActive;
    return changes;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const changes = buildChanges();
    if (Object.keys(changes).length === 0) return;

    setBusy(true);
    try {
      const response = await fetch("/api/admin/templates/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "update", templateIds, changes }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not apply that.");
      }
      const body = await response.json();
      toast(`${body.updated} task${body.updated === 1 ? "" : "s"} updated. Future instances only.`);
      onSaved();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not apply that.", { tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  const changing = on.size;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30 animate-fade-in" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${count} tasks`}
        className="relative flex h-full w-full max-w-md flex-col bg-card shadow-xl animate-slide-up sm:animate-fade-in"
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="font-semibold">
            Edit {count} task{count === 1 ? "" : "s"}
          </h2>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded-md p-2 hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <p className="mb-4 text-sm text-muted-foreground">
              Tick only what you want to change. Anything left unticked stays as it is on each
              task.
            </p>

            <div className="flex flex-col gap-1">
              <Row label="Owner" field="assigneeId" on={on} toggle={toggle}>
                <Select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
                  {users
                    .filter((u) => u.isActive)
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                </Select>
              </Row>

              <Row label="Category" field="categoryId" on={on} toggle={toggle}>
                <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                  <option value="">No category</option>
                  {categories
                    .filter((c) => c.isActive)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </Select>
              </Row>

              <Row label="Frequency" field="frequency" on={on} toggle={toggle}>
                <Select
                  value={frequency}
                  onChange={(e) => setFrequency(e.target.value as Frequency)}
                >
                  <option value={Frequency.DAILY}>Daily</option>
                  <option value={Frequency.WEEKLY}>Weekly</option>
                  <option value={Frequency.MONTHLY}>Monthly</option>
                  <option value={Frequency.ONE_OFF}>One-off</option>
                </Select>

                {frequency === Frequency.DAILY ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {WEEKDAYS.map((day) => {
                      const picked = daysOfWeek.includes(day.value);
                      return (
                        <button
                          key={day.value}
                          type="button"
                          aria-pressed={picked}
                          onClick={() =>
                            setDaysOfWeek((current) =>
                              current.includes(day.value)
                                ? current.filter((d) => d !== day.value)
                                : [...current, day.value].sort((a, b) => a - b),
                            )
                          }
                          className={cn(
                            "h-9 rounded-md border px-2.5 text-xs font-medium",
                            picked
                              ? "border-primary bg-primary text-primary-foreground"
                              : "text-muted-foreground hover:bg-accent",
                          )}
                        >
                          {day.label}
                        </button>
                      );
                    })}
                  </div>
                ) : null}

                {frequency === Frequency.WEEKLY ? (
                  <Select
                    className="mt-2"
                    value={dayOfWeek}
                    onChange={(e) => setDayOfWeek(Number(e.target.value))}
                  >
                    {WEEKDAYS.map((d) => (
                      <option key={d.value} value={d.value}>
                        Every {d.label}
                      </option>
                    ))}
                  </Select>
                ) : null}

                {frequency === Frequency.MONTHLY ? (
                  <Input
                    className="mt-2"
                    type="number"
                    min={1}
                    max={31}
                    value={dayOfMonth}
                    onChange={(e) => setDayOfMonth(Number(e.target.value))}
                  />
                ) : null}
              </Row>

              <Row label="Due by" field="dueTime" on={on} toggle={toggle}>
                <Input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
                <p className="mt-1 text-xs text-muted-foreground">
                  Leave empty to clear the deadline — the task then runs to end of day.
                </p>
              </Row>

              <Row label="Start date" field="startDate" on={on} toggle={toggle}>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </Row>

              <Row label="End date" field="endDate" on={on} toggle={toggle}>
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                <p className="mt-1 text-xs text-muted-foreground">
                  Leave empty to remove an end date and let these run indefinitely.
                </p>
              </Row>

              <Row label="Status" field="isActive" on={on} toggle={toggle}>
                <Select
                  value={isActive ? "active" : "inactive"}
                  onChange={(e) => setIsActive(e.target.value === "active")}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </Select>
                <p className="mt-1 text-xs text-muted-foreground">
                  Deactivating removes unstarted future work. History is kept.
                </p>
              </Row>
            </div>
          </div>

          <div className="flex items-center gap-2 border-t px-4 py-3">
            <Button type="submit" disabled={changing === 0 || busy}>
              {busy
                ? "Applying…"
                : changing === 0
                  ? "Nothing selected"
                  : `Apply to ${count} task${count === 1 ? "" : "s"}`}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            {changing > 0 ? (
              <span className="ml-auto text-xs text-muted-foreground">
                {changing} field{changing === 1 ? "" : "s"}
              </span>
            ) : null}
          </div>
        </form>
      </div>
    </div>
  );
}

/** A field, and the tick that decides whether this edit touches it at all. */
function Row({
  label,
  field,
  on,
  toggle,
  children,
}: {
  label: string;
  field: Field;
  on: Set<Field>;
  toggle: (field: Field) => void;
  children: React.ReactNode;
}) {
  const active = on.has(field);
  return (
    <div className={cn("rounded-lg border px-3 py-2.5", active ? "border-primary/40 bg-primary/5" : "border-transparent")}>
      <label className="flex cursor-pointer items-center gap-2.5">
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={active}
          onChange={() => toggle(field)}
        />
        <span className={cn("text-sm font-medium", !active && "text-muted-foreground")}>
          {label}
        </span>
      </label>
      {active ? <div className="mt-2 pl-[26px]">{children}</div> : null}
    </div>
  );
}
