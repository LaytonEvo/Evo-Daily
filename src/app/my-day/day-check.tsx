"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

/**
 * Yesterday went badly: say why before starting today.
 *
 * Deliberately the one thing in the app with no way out. Everything else here
 * can be put off; a day under half done is the thing the business most needs a
 * sentence about, and the sentence is worth least a week later when nobody can
 * remember what the afternoon was like.
 *
 * The tasks are listed rather than counted. "Five didn't get done" is a number
 * somebody has to go and look up before they can answer honestly, and a
 * question that takes work to answer gets "busy" as the answer.
 */
export function DayCheck({
  day,
  completed,
  total,
  missed,
}: {
  /** Yesterday, already written the way it should read: "Tuesday 22 September". */
  day: string;
  completed: number;
  total: number;
  missed: string[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);

  // No escape, and no scrolling the page behind it. The point of this dialog is
  // that it is answered.
  useEffect(() => {
    const swallowEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") event.preventDefault();
    };
    document.addEventListener("keydown", swallowEscape);
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", swallowEscape);
      document.body.style.overflow = overflow;
    };
  }, []);

  const answer = reason.trim();
  const tooShort = answer.length < 10;

  async function submit() {
    setPending(true);
    const response = await fetch("/api/me/day-check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: answer }),
    });
    setPending(false);

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      toast(body.error ?? "Could not save that.", { tone: "error" });
      return;
    }

    router.refresh();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      <div className="absolute inset-0 bg-foreground/50 animate-fade-in" aria-hidden />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="day-check-title"
        className="relative flex max-h-[90vh] w-full max-w-md flex-col overflow-y-auto rounded-lg bg-card p-5 shadow-card animate-slide-up sm:p-6"
      >
        <h2 id="day-check-title" className="text-lg font-bold leading-tight">
          Yesterday: {completed} of {total} done
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {day} finished under half. Before you start today, say what got in the way — your
          answer goes on the record next to yesterday&apos;s numbers, where the management team
          will read it.
        </p>

        <div className="mt-4 rounded-xl bg-muted/60 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Not done
          </p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {missed.map((title) => (
              <li key={title} className="text-sm leading-snug">
                {title}
              </li>
            ))}
          </ul>
        </div>

        <label htmlFor="day-check-reason" className="mt-4 block text-sm font-medium">
          What stopped these getting done?
        </label>
        <textarea
          id="day-check-reason"
          rows={4}
          maxLength={1000}
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="On the shop floor covering Alex all afternoon, so the stock count never started."
          className="mt-1 w-full rounded-xl border border-input bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <p className="mt-1.5 text-xs text-muted-foreground">
          A sentence is plenty. If the work was never realistic yesterday, say that — that is
          worth knowing too.
        </p>

        <Button
          className="mt-4 w-full"
          disabled={tooShort || pending}
          onClick={() => void submit()}
        >
          {pending ? "Saving…" : "Save and start today"}
        </Button>
      </div>
    </div>
  );
}
