"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";

const GRACE = [
  { days: 0, label: "Same day", hint: "Not done by midnight is missed." },
  { days: 1, label: "1 day", hint: "Yesterday's unfinished work is written off tonight." },
  { days: 2, label: "2 days", hint: "A day either side to catch up." },
  { days: 3, label: "3 days", hint: "A long weekend to catch up." },
  { days: 7, label: "7 days", hint: "A week. Little is ever formally missed." },
];

const HORIZON = [14, 30, 60, 90];

/**
 * The two org-wide numbers, and they are related.
 *
 * The catch-up window decides when unfinished work becomes a miss. The horizon
 * decides how far ahead occurrences exist — which is also how far ahead anyone
 * can be shown their work, so a monthly stocktake cannot give five days'
 * notice unless the horizon reaches past it. They are on one card because
 * changing either without knowing the other is how you end up with a setting
 * that silently does nothing.
 */
export function SettingsEditor({
  graceDays,
  generationHorizonDays,
  longestNotice,
}: {
  graceDays: number;
  generationHorizonDays: number;
  /** The most notice any task asks for, so the card can say when it is unreachable. */
  longestNotice: number;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [grace, setGrace] = useState(graceDays);
  const [horizon, setHorizon] = useState(generationHorizonDays);
  const [busy, setBusy] = useState(false);

  const chosen = GRACE.find((c) => c.days === grace);
  const dirty = grace !== graceDays || horizon !== generationHorizonDays;
  const noticeUnreachable = longestNotice > horizon;

  async function save() {
    setBusy(true);
    try {
      const response = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ graceDays: grace, generationHorizonDays: horizon }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not save that.");
      }
      const body = (await response.json()) as { swept: number; generated: number };
      const parts = [
        body.swept > 0 ? `${body.swept} moved to missed` : "",
        body.generated > 0 ? `${body.generated} future task${body.generated === 1 ? "" : "s"} created` : "",
      ].filter(Boolean);
      toast(parts.length > 0 ? `Saved. ${parts.join(", ")}.` : "Saved.");
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
        <CardTitle>Timings</CardTitle>
        <CardDescription>
          Two numbers everything else works from: when unfinished work counts as missed, and how
          far ahead work exists to be seen.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-5">
          <div>
            <p className="text-sm font-medium">Catch-up window</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              How long an unfinished task stays open before it counts as missed. It is the number
              behind every completion rate in the reports.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Select
                className="h-10 w-auto"
                aria-label="Catch-up window"
                value={grace}
                onChange={(e) => setGrace(Number(e.target.value))}
              >
                {GRACE.map((choice) => (
                  <option key={choice.days} value={choice.days}>
                    {choice.label}
                  </option>
                ))}
              </Select>
              {chosen ? (
                <span className="text-sm text-muted-foreground">{chosen.hint}</span>
              ) : null}
            </div>
            {grace < graceDays ? (
              // Shortening it is not a neutral edit: work that was catchable
              // this morning is a miss on somebody's record this afternoon.
              <p className="mt-2 text-sm text-warning">
                Shortening this writes off anything already outside the new window, straight
                away. Those tasks count as missed in every report from then on.
              </p>
            ) : null}
          </div>

          <div className="border-t pt-5">
            <p className="text-sm font-medium">How far ahead tasks are created</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Occurrences are generated this far in advance. It caps how much notice a task can
              give: nothing can appear on somebody&rsquo;s day before it exists.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Select
                className="h-10 w-auto"
                aria-label="How far ahead tasks are created"
                value={horizon}
                onChange={(e) => setHorizon(Number(e.target.value))}
              >
                {HORIZON.map((days) => (
                  <option key={days} value={days}>
                    {days} days
                  </option>
                ))}
              </Select>
              <span className="text-sm text-muted-foreground">
                Enough notice for a task due up to {horizon} days out.
              </span>
            </div>

            {noticeUnreachable ? (
              <p className="mt-2 text-sm text-warning">
                A task asks for {longestNotice} days&rsquo; notice, which is further ahead than
                work is created. It will appear {horizon} days before it is due, not{" "}
                {longestNotice}.
              </p>
            ) : null}
            {horizon < generationHorizonDays ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Occurrences already created past the new horizon are left alone. Nothing is
                deleted.
              </p>
            ) : null}
          </div>

          <div>
            <Button size="sm" disabled={!dirty || busy} onClick={() => void save()}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
