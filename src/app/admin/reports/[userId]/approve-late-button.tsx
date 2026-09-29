"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { formatDateOnly, formatTimeLondon, toDateOnly } from "@/lib/time";

/**
 * Accept a late completion.
 *
 * Most "Completed late" badges are not late work. They are work done on time
 * and ticked off afterwards — finished at five, remembered at seven. Without
 * somewhere to say so, the on-time rate slowly fills with cases everybody
 * knows are wrong, and a number people argue with is a number nobody acts on.
 *
 * Reversible, and it says who accepted it. An approval nobody can be asked
 * about is not much better than no record at all.
 */
export function ApproveLateButton({
  instanceId,
  title,
  approvedAt,
  approvedByName,
}: {
  instanceId: string;
  title: string;
  approvedAt: Date | string | null;
  approvedByName: string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = useState(false);

  const approved = approvedAt !== null;

  async function send(next: boolean) {
    setPending(true);
    const response = await fetch(`/api/instances/${instanceId}/approve-late`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approved: next }),
    });
    setPending(false);

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      toast(body.error ?? "Could not save that.", { tone: "error" });
      return;
    }

    toast(next ? `${title} — late tick approved.` : `${title} — approval removed.`);
    router.refresh();
  }

  if (approved) {
    return (
      <button
        type="button"
        disabled={pending}
        onClick={() => void send(false)}
        title={`Approved${approvedByName ? ` by ${approvedByName}` : ""}${
          approvedAt ? ` · ${when(approvedAt)}` : ""
        }. Click to undo.`}
        className="inline-flex h-9 items-center gap-1 rounded-lg px-2 text-xs font-medium text-success hover:bg-accent disabled:opacity-50"
      >
        <Check className="h-3.5 w-3.5" />
        Approved
      </button>
    );
  }

  return (
    <Button variant="outline" size="sm" disabled={pending} onClick={() => void send(true)}>
      Approve
    </Button>
  );
}

/** "Tue 22 Sep 16:53". */
function when(value: Date | string): string {
  const at = value instanceof Date ? value : new Date(value);
  return `${formatDateOnly(toDateOnly(at))} ${formatTimeLondon(at)}`;
}
