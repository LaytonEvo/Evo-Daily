"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { InstanceStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

/**
 * Write a pending task off as not done.
 *
 * The point is to get work that is never going to happen out of someone's day
 * without pretending it was done. It still counts as a miss, so the reason is
 * required — a miss with no explanation is what makes a leaderboard arguable
 * three weeks later.
 */
export function NotDoneButton({
  instanceId,
  title,
  status,
}: {
  instanceId: string;
  title: string;
  status: InstanceStatus;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);

  // Already missed: nothing to write off.
  if (status === InstanceStatus.MISSED) return null;

  async function submit() {
    setPending(true);
    const response = await fetch(`/api/instances/${instanceId}/not-done`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: reason.trim() }),
    });
    setPending(false);

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      toast(body.error ?? "Could not save that.", { tone: "error" });
      return;
    }

    setOpen(false);
    setReason("");
    toast(`${title} — recorded as not done.`);
    router.refresh();
  }

  if (!open) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Not done
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      <div
        className="absolute inset-0 bg-foreground/40 animate-fade-in"
        onClick={() => setOpen(false)}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Record ${title} as not done`}
        className="relative w-full max-w-sm rounded-lg bg-card p-5 shadow-card animate-slide-up"
      >
        <h2 className="font-bold">Record as not done</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {title} leaves their day and counts as a miss in the reports.
        </p>

        <label htmlFor="not-done-reason" className="mt-4 block text-sm font-medium">
          Why is it not getting done?
        </label>
        <textarea
          id="not-done-reason"
          rows={3}
          maxLength={500}
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Shop shut for the bank holiday"
          className="mt-1 w-full rounded-xl border border-input bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />

        <div className="mt-4 flex gap-2">
          <Button
            variant="destructive"
            className="flex-1"
            disabled={!reason.trim() || pending}
            onClick={() => void submit()}
          >
            {pending ? "Saving…" : "Record as not done"}
          </Button>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
