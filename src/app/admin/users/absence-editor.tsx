"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarOff, Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

export type AbsenceRow = {
  id: string;
  from: string;
  to: string;
  reason: string | null;
  user: { id: string; name: string };
  cover: { id: string; name: string } | null;
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
    <Card className="mt-6">
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
                {row.cover ? (
                  <Badge variant="default">covered by {row.cover.name.split(" ")[0]}</Badge>
                ) : (
                  <Badge variant="muted">excused</Badge>
                )}
                <button
                  type="button"
                  aria-label={`Remove time off for ${row.user.name}`}
                  onClick={() => void remove(row)}
                  className="ml-auto text-muted-foreground hover:text-destructive"
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
              Cover
              <span className="ml-1 font-normal text-muted-foreground">optional</span>
            </label>
            <Select
              id="absent-cover"
              value={coverUserId}
              onChange={(e) => setCoverUserId(e.target.value)}
            >
              <option value="">Nobody — excuse these days</option>
              {active
                .filter((p) => p.id !== userId)
                .map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
            </Select>
            <p className="text-xs text-muted-foreground">
              {coverUserId
                ? "Their tasks move across and count as normal."
                : "Their tasks stay visible but count neither way."}
            </p>
          </div>

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
