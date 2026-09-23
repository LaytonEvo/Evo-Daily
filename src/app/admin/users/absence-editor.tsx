"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarOff, Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

type TaskRow = {
  id: string;
  title: string;
  schedule: string;
  categoryName: string | null;
  categoryColour: string | null;
};

export type AbsenceRow = {
  id: string;
  from: string;
  to: string;
  reason: string | null;
  user: { id: string; name: string };
  cover: { id: string; name: string } | null;
  /** Per-task overrides, so the row can say when it is not all-or-nothing. */
  covers: { templateId: string; coverUserId: string | null; coverName: string | null }[];
};

/**
 * Time off, and who is covering.
 *
 * Deliberately blunt about the consequence of leaving cover empty, because the
 * two outcomes are very different and the difference is invisible afterwards:
 * with cover the work still gets done and counts against someone; without, the
 * days are excused and simply do not happen.
 */
export function AbsenceEditor({
  absences,
  people,
}: {
  absences: AbsenceRow[];
  people: { id: string; name: string; isActive: boolean }[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);

  async function remove(row: AbsenceRow) {
    const response = await fetch(`/api/admin/absences/${row.id}`, { method: "DELETE" });
    if (!response.ok) {
      toast("Could not remove that.", { tone: "error" });
      return;
    }
    const { restored } = await response.json();
    toast(
      restored > 0
        ? `Removed. ${restored} task${restored === 1 ? "" : "s"} back on ${row.user.name.split(" ")[0]}.`
        : "Removed.",
    );
    router.refresh();
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Time off</CardTitle>
          <CardDescription>
            Covered days move to someone else. Uncovered days are excused — they stay on the
            record but count neither way.
          </CardDescription>
        </div>
        <Button size="sm" onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" />
          Add
        </Button>
      </CardHeader>

      <CardContent>
        {absences.length === 0 ? (
          <p className="text-sm italic text-muted-foreground">Nothing booked.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {absences.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-muted/60 px-3 py-2 text-sm"
              >
                <CalendarOff className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="font-semibold">{row.user.name}</span>
                <span className="text-muted-foreground">
                  {formatRange(row.from, row.to)}
                </span>
                {row.reason ? (
                  <span className="text-muted-foreground">· {row.reason}</span>
                ) : null}
                {describeCover(row).map((label, i) => (
                  <Badge key={i} variant={label.startsWith("excused") ? "muted" : "default"}>
                    {label}
                  </Badge>
                ))}
                <button
                  type="button"
                  aria-label={`Remove time off for ${row.user.name}`}
                  onClick={() => void remove(row)}
                  className="-my-2 -mr-1 ml-auto flex h-10 w-10 shrink-0 items-center justify-center text-muted-foreground hover:text-destructive"
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {adding ? (
        <AbsenceDialog
          people={people}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            router.refresh();
          }}
        />
      ) : null}
    </Card>
  );
}

function AbsenceDialog({
  people,
  onClose,
  onSaved,
}: {
  people: { id: string; name: string; isActive: boolean }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const active = people.filter((p) => p.isActive);
  const [userId, setUserId] = useState(active[0]?.id ?? "");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [coverUserId, setCoverUserId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [tasks, setTasks] = useState<TaskRow[] | null>(null);
  // templateId -> cover user id, or "" for excused. Only holds overrides.
  const [perTask, setPerTask] = useState<Record<string, string>>({});

  // Their tasks, reloaded when the person changes — the list is what you are
  // choosing between, so it has to follow the selection.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setTasks(null);
    setPerTask({});
    fetch(`/api/admin/users/${userId}/templates`)
      .then((r) => (r.ok ? r.json() : { templates: [] }))
      .then((d) => {
        if (!cancelled) setTasks(d.templates ?? []);
      })
      .catch(() => {
        if (!cancelled) setTasks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  /** What this task resolves to right now: an override, else the default. */
  const resolved = (templateId: string) =>
    templateId in perTask ? perTask[templateId] : coverUserId;

  const others = active.filter((p) => p.id !== userId);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const response = await fetch("/api/admin/absences", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        userId,
        from,
        to,
        reason: reason.trim() || null,
        coverUserId: coverUserId || null,
        // Only send genuine overrides; the rest follow the default.
        covers: Object.entries(perTask)
          .filter(([templateId]) => resolved(templateId) !== coverUserId)
          .map(([templateId, cover]) => ({ templateId, coverUserId: cover || null })),
      }),
    });
    setPending(false);

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setError(payload.error ?? "Could not save that.");
      return;
    }

    const { covered, excused } = await response.json();
    toast(
      covered > 0
        ? `Saved. ${covered} task${covered === 1 ? "" : "s"} moved to cover.`
        : `Saved. ${excused} task${excused === 1 ? "" : "s"} excused.`,
    );
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      <div className="absolute inset-0 bg-foreground/40 animate-fade-in" onClick={onClose} aria-hidden />
      <form
        onSubmit={submit}
        className="relative w-full max-w-sm rounded-lg bg-card p-5 shadow-card animate-slide-up"
      >
        <h2 className="font-bold">Add time off</h2>

        <div className="mt-4 flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="absent-who" className="text-sm font-medium">Who</label>
            <Select id="absent-who" value={userId} onChange={(e) => setUserId(e.target.value)} required>
              {active.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </div>

          <div className="flex gap-3">
            <div className="flex flex-1 flex-col gap-1.5">
              <label htmlFor="absent-from" className="text-sm font-medium">First day</label>
              <Input id="absent-from" type="date" required value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <label htmlFor="absent-to" className="text-sm font-medium">Last day</label>
              <Input id="absent-to" type="date" required value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="absent-cover" className="text-sm font-medium">
              Cover everything with
            </label>
            <Select
              id="absent-cover"
              value={coverUserId}
              onChange={(e) => {
                setCoverUserId(e.target.value);
                // The default is what you set here; per-task choices start again
                // from it rather than silently outranking it.
                setPerTask({});
              }}
            >
              <option value="">Nobody — excuse them</option>
              {others.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
            <p className="text-xs text-muted-foreground">
              Change any single task below.
            </p>
          </div>

          {tasks === null ? (
            <p className="text-sm text-muted-foreground">Loading their tasks…</p>
          ) : tasks.length === 0 ? (
            <p className="text-sm italic text-muted-foreground">
              They have no active recurring tasks.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              <p className="text-sm font-medium">
                Tasks
                <span className="ml-1 font-normal text-muted-foreground">
                  {summarise(tasks, resolved)}
                </span>
              </p>
              <ul className="max-h-56 overflow-y-auto rounded-xl border border-input">
                {tasks.map((task) => (
                  <li
                    key={task.id}
                    className="flex items-center gap-2 border-b px-3 py-2 last:border-0"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{task.title}</p>
                      <p className="truncate text-xs text-muted-foreground">{task.schedule}</p>
                    </div>
                    <Select
                      aria-label={`Cover for ${task.title}`}
                      value={resolved(task.id)}
                      onChange={(e) =>
                        setPerTask((current) => ({ ...current, [task.id]: e.target.value }))
                      }
                      className="h-9 w-36 shrink-0 text-xs"
                    >
                      <option value="">Excuse</option>
                      {others.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </Select>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="absent-reason" className="text-sm font-medium">
              Reason
              <span className="ml-1 font-normal text-muted-foreground">optional</span>
            </label>
            <Input
              id="absent-reason"
              value={reason}
              maxLength={200}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Annual leave"
            />
          </div>

          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        </div>

        <div className="mt-5 flex gap-2">
          <Button type="submit" className="flex-1" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </div>
  );
}

function formatRange(from: string, to: string): string {
  const fmt = (d: string) =>
    new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return from === to ? fmt(from) : `${fmt(from)} – ${fmt(to)}`;
}

/** "4 covered, 2 excused" — so the consequence is visible before saving. */
function summarise(tasks: TaskRow[], resolved: (id: string) => string): string {
  const covered = tasks.filter((t) => resolved(t.id)).length;
  const excused = tasks.length - covered;
  if (covered === 0) return `— all ${excused} excused`;
  if (excused === 0) return `— all ${covered} covered`;
  return `— ${covered} covered, ${excused} excused`;
}

/**
 * Badges for one row. All-or-nothing reads as one badge; a mixed absence names
 * each cover person and how many tasks they took, because "covered" alone
 * would hide that half of it was not.
 */
function describeCover(row: AbsenceRow): string[] {
  if (row.covers.length === 0) {
    return [row.cover ? `covered by ${row.cover.name.split(" ")[0]}` : "excused"];
  }

  const counts = new Map<string, number>();
  for (const c of row.covers) {
    const key = c.coverName ? c.coverName.split(" ")[0] : "excused";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const base = row.cover ? `rest to ${row.cover.name.split(" ")[0]}` : "rest excused";
  return [
    ...[...counts].map(([who, n]) => (who === "excused" ? `excused ${n}` : `${who} ${n}`)),
    base,
  ];
}
