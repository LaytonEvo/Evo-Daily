"use client";

import { useEffect, useRef, useState } from "react";
import { Frequency } from "@prisma/client";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { Category, Person, TemplateRow } from "./templates-screen";

const WEEKDAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 7, label: "Sun" },
];

/**
 * Create and edit. The field order is the order a manager thinks in — title,
 * who, how often, then the schedule detail — and everything below that is
 * optional. Defining a recurring task should take under 30 seconds.
 */
export function TemplateDrawer({
  template,
  users,
  categories,
  onClose,
  onSaved,
}: {
  template: TemplateRow | null;
  users: Person[];
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const today = useRef(new Date().toISOString().slice(0, 10)).current;

  const [title, setTitle] = useState(template?.title ?? "");
  const [assigneeId, setAssigneeId] = useState(
    template?.assigneeId ?? users.find((u) => u.isActive)?.id ?? "",
  );
  const [frequency, setFrequency] = useState<Frequency>(template?.frequency ?? Frequency.DAILY);
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(
    template?.daysOfWeek?.length ? template.daysOfWeek : [1, 2, 3, 4, 5],
  );
  const [dayOfWeek, setDayOfWeek] = useState<number>(template?.dayOfWeek ?? 1);
  const [dayOfMonth, setDayOfMonth] = useState<number>(template?.dayOfMonth ?? 1);
  const [categoryId, setCategoryId] = useState(template?.categoryId ?? "");
  const [dueTime, setDueTime] = useState(template?.dueTime ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [startDate, setStartDate] = useState(template?.startDate ?? today);
  const [endDate, setEndDate] = useState(template?.endDate ?? "");
  const [isActive, setIsActive] = useState(template?.isActive ?? true);

  const [preview, setPreview] = useState<{ description: string; labels: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Live preview: "Next 3 due dates: Thu 28 Aug, Fri 29 Aug, Mon 1 Sep."
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch("/api/admin/templates/preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            frequency,
            daysOfWeek,
            dayOfWeek,
            dayOfMonth,
            startDate,
            endDate: endDate || null,
          }),
        });
        if (response.ok) setPreview(await response.json());
      } catch {
        // A cancelled or failed preview is not worth interrupting the form for.
      }
    }, 150);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [frequency, daysOfWeek, dayOfWeek, dayOfMonth, startDate, endDate]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const body = {
      title,
      description: description.trim() || null,
      categoryId: categoryId || null,
      assigneeId,
      frequency,
      daysOfWeek: frequency === Frequency.DAILY ? daysOfWeek : [],
      dayOfWeek: frequency === Frequency.WEEKLY ? dayOfWeek : null,
      dayOfMonth: frequency === Frequency.MONTHLY ? dayOfMonth : null,
      dueTime: dueTime || null,
      startDate,
      endDate: endDate || null,
      isActive,
    };

    const response = await fetch(
      template ? `/api/admin/templates/${template.id}` : "/api/admin/templates",
      {
        method: template ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setError(payload.error ?? "Could not save that task.");
      setPending(false);
      return;
    }

    toast(template ? "Saved. Future instances updated." : "Task created.");
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-black/30 animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={template ? "Edit task" : "New task"}
        className="relative flex h-full w-full max-w-md flex-col bg-card shadow-xl animate-slide-up sm:animate-fade-in"
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="font-semibold">{template ? "Edit task" : "New task"}</h2>
          <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <div className="flex flex-col gap-4">
              <Field label="Title" htmlFor="title">
                <Input
                  id="title"
                  required
                  autoFocus
                  maxLength={200}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Clear the support inbox"
                />
              </Field>

              <Field label="Owner" htmlFor="assignee" hint="One person. Shared ownership is no ownership.">
                <Select
                  id="assignee"
                  required
                  value={assigneeId}
                  onChange={(e) => setAssigneeId(e.target.value)}
                >
                  {users.map((u) => (
                    <option key={u.id} value={u.id} disabled={!u.isActive}>
                      {u.name}
                      {u.isActive ? "" : " (inactive)"}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="How often" htmlFor="frequency">
                <Select
                  id="frequency"
                  value={frequency}
                  onChange={(e) => setFrequency(e.target.value as Frequency)}
                >
                  <option value={Frequency.DAILY}>Daily</option>
                  <option value={Frequency.WEEKLY}>Weekly</option>
                  <option value={Frequency.MONTHLY}>Monthly</option>
                  <option value={Frequency.ONE_OFF}>One-off</option>
                </Select>
              </Field>

              {frequency === Frequency.DAILY ? (
                <Field label="Which days" hint="A task that fires at weekends must say so.">
                  <div className="flex flex-wrap gap-1.5">
                    {WEEKDAYS.map((day) => {
                      const on = daysOfWeek.includes(day.value);
                      return (
                        <button
                          key={day.value}
                          type="button"
                          aria-pressed={on}
                          onClick={() =>
                            setDaysOfWeek((current) =>
                              current.includes(day.value)
                                ? current.filter((d) => d !== day.value)
                                : [...current, day.value].sort((a, b) => a - b),
                            )
                          }
                          className={cn(
                            "h-11 w-11 rounded-md border text-sm font-medium transition-colors",
                            on
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-input hover:bg-accent",
                          )}
                        >
                          {day.label}
                        </button>
                      );
                    })}
                  </div>
                </Field>
              ) : null}

              {frequency === Frequency.WEEKLY ? (
                <Field label="Day of the week" htmlFor="dayOfWeek">
                  <Select
                    id="dayOfWeek"
                    value={dayOfWeek}
                    onChange={(e) => setDayOfWeek(Number(e.target.value))}
                  >
                    {WEEKDAYS.map((day) => (
                      <option key={day.value} value={day.value}>
                        {day.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}

              {frequency === Frequency.MONTHLY ? (
                <Field
                  label="Day of the month"
                  htmlFor="dayOfMonth"
                  hint="31 lands on the last day of shorter months."
                >
                  <Select
                    id="dayOfMonth"
                    value={dayOfMonth}
                    onChange={(e) => setDayOfMonth(Number(e.target.value))}
                  >
                    {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                      <option key={day} value={day}>
                        {day}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : null}

              {preview ? (
                <p className="rounded-md bg-muted px-3 py-2 text-sm">
                  <span className="font-medium">{preview.description}.</span>{" "}
                  {preview.labels.length > 0 ? (
                    <>Next {preview.labels.length} due: {preview.labels.join(", ")}.</>
                  ) : (
                    <span className="text-muted-foreground">Nothing due in the next few weeks.</span>
                  )}
                </p>
              ) : null}

              <hr className="my-1" />

              <Field label="Category" htmlFor="category" optional>
                <Select
                  id="category"
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                >
                  <option value="">None</option>
                  {categories
                    // A retired category is hidden, unless this task already
                    // uses it — otherwise opening the drawer would quietly
                    // clear the category on save.
                    .filter((c) => c.isActive || c.id === categoryId)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.isActive ? "" : " (turned off)"}
                      </option>
                    ))}
                </Select>
              </Field>

              <Field
                label="Cut-off time"
                htmlFor="dueTime"
                optional
                hint="Anything completed after this counts as late."
              >
                <Input
                  id="dueTime"
                  type="time"
                  value={dueTime}
                  onChange={(e) => setDueTime(e.target.value)}
                />
              </Field>

              <Field label="Description" htmlFor="description" optional>
                <Textarea
                  id="description"
                  rows={3}
                  maxLength={2000}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What good looks like. Keep it to a couple of lines."
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label={frequency === Frequency.ONE_OFF ? "Due date" : "Starts"} htmlFor="startDate">
                  <Input
                    id="startDate"
                    type="date"
                    required
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </Field>
                {frequency === Frequency.ONE_OFF ? null : (
                  <Field label="Ends" htmlFor="endDate" optional>
                    <Input
                      id="endDate"
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                    />
                  </Field>
                )}
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                />
                Active
              </label>

              {template ? (
                <p className="text-xs text-muted-foreground">
                  Saving changes future instances only. Today&rsquo;s tasks and all history keep
                  the title, owner and category they were created with.
                </p>
              ) : null}

              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
            </div>
          </div>

          <div className="flex gap-2 border-t px-4 py-3 safe-bottom">
            <Button type="submit" className="flex-1" disabled={pending}>
              {pending ? "Saving…" : template ? "Save changes" : "Create task"}
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  optional,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
        {optional ? <span className="ml-1 font-normal text-muted-foreground">optional</span> : null}
      </label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
