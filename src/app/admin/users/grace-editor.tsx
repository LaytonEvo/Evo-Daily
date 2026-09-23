"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

const CHOICES = [
  { days: 0, label: "Same day", hint: "Not done by midnight is missed." },
  { days: 1, label: "1 day", hint: "Yesterday's unfinished work is written off tonight." },
  { days: 2, label: "2 days", hint: "A day either side to catch up." },
  { days: 3, label: "3 days", hint: "A long weekend to catch up." },
  { days: 7, label: "7 days", hint: "A week. Little is ever formally missed." },
];

/**
 * How long somebody has to catch up before a task counts as missed.
 *
 * It was a database column with no way to reach it, which meant the number
 * that decides every completion rate in the app was whatever it had been
 * seeded as. Shortening it is the interesting direction — that is what makes
 * "he did not do it" appear in a report rather than sit as "still open"
 * indefinitely — so the save sweeps immediately and says how many moved.
 */
export function GraceEditor({ graceDays }: { graceDays: number }) {
  const router = useRouter();
  const { toast } = useToast();
  const [value, setValue] = useState(graceDays);
  const [busy, setBusy] = useState(false);

  const chosen = CHOICES.find((c) => c.days === value);
  const dirty = value !== graceDays;

  async function save() {
    setBusy(true);
    try {
      const response = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ graceDays: value }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not save that.");
      }
      const body = (await response.json()) as { swept: number };
      toast(
        body.swept > 0
          ? `Saved. ${body.swept} task${body.swept === 1 ? "" : "s"} moved to missed.`
          : "Saved.",
      );
      router.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not save that.", { tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Catch-up window</CardTitle>
        <CardDescription>
          How long an unfinished task stays open before it counts as missed. It is the number
          behind every completion rate in the reports.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            className="h-10 w-auto"
            aria-label="Catch-up window"
            value={value}
            onChange={(e) => setValue(Number(e.target.value))}
          >
            {CHOICES.map((choice) => (
              <option key={choice.days} value={choice.days}>
                {choice.label}
              </option>
            ))}
          </Select>
          <Button size="sm" disabled={!dirty || busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save"}
          </Button>
          {chosen ? (
            <span className="text-sm text-muted-foreground">{chosen.hint}</span>
          ) : null}
        </div>

        {dirty && value < graceDays ? (
          // Shortening it is not a neutral edit: work that was catchable this
          // morning is a miss on somebody's record this afternoon.
          <p className="mt-3 text-sm text-warning">
            Shortening this writes off anything already outside the new window, straight away.
            Those tasks count as missed in every report from then on.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
