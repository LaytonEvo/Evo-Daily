"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

export type ApprovalCardData = {
  id: string;
  title: string;
  moduleLabel: string;
  typeLabel: string;
  summary: string;
  previewUrl: string | null;
  waiting: string;
  stale: boolean;
  assigneeName: string | null;
  fields: { key: string; label: string; multiline?: boolean; value: string }[];
};

export function ApprovalCard({ approval }: { approval: ApprovalCardData }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [rework, setRework] = useState(false);
  const [values, setValues] = useState(() => Object.fromEntries(approval.fields.map((f) => [f.key, f.value])));

  async function decide(decision: "approve" | "reject") {
    setPending(true);
    const edits = Object.fromEntries(
      approval.fields.filter((f) => values[f.key] !== f.value).map((f) => [f.key, values[f.key]]),
    );
    const response = await fetch(`/api/approvals/${approval.id}/decide`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision, note: note || null, rework, ...(decision === "approve" ? { edits } : {}) }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      alreadyDecided?: boolean;
      executionStatus?: string | null;
    };
    if (!response.ok) {
      toast(body.error ?? "That didn't go through.", { tone: "error" });
      setPending(false);
      return;
    }
    if (body.alreadyDecided) toast("Someone had already decided this one.");
    else if (decision === "reject") toast(rework ? "Rejected, and a rework task raised." : "Rejected.");
    else if (body.executionStatus === "failed") toast("Approved, but carrying it out failed. See the item.", { tone: "error" });
    else toast("Approved and carried out.");
    router.refresh();
  }

  return (
    <Card className={cn("flex flex-col gap-3 p-4 sm:p-5", approval.stale && "ring-1 ring-warning")}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge>{approval.moduleLabel}</Badge>
        <span className="text-muted-foreground">{approval.typeLabel}</span>
        <span className={cn("ml-auto", approval.stale ? "font-bold text-warning" : "text-muted-foreground")}>
          waiting {approval.waiting}
        </span>
      </div>
      <a href={`/approvals/${approval.id}`} className="text-base font-bold leading-snug hover:underline">
        {approval.title}
      </a>
      <p className="whitespace-pre-wrap text-sm text-muted-foreground">{approval.summary}</p>
      {approval.previewUrl ? (
        <a
          href={approval.previewUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          Open preview <ExternalLink className="h-3.5 w-3.5" />
        </a>
      ) : null}

      {approval.fields.map((f) => (
        <label key={f.key} className="flex flex-col gap-1 text-sm">
          <span className="font-medium">{f.label}</span>
          {f.multiline ? (
            <textarea
              rows={3}
              value={values[f.key]}
              disabled={pending}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              className="rounded-md border bg-background px-3 py-2"
            />
          ) : (
            <input
              value={values[f.key]}
              disabled={pending}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              className="rounded-md border bg-background px-3 py-2"
            />
          )}
        </label>
      ))}

      {rejecting ? (
        <div className="flex flex-col gap-2 rounded-md bg-destructive/5 p-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Why not?</span>
            <textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="rounded-md border bg-background px-3 py-2"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={rework} onChange={(e) => setRework(e.target.checked)} />
            Raise a task to rework it
          </label>
          <div className="flex gap-2">
            <Button type="button" variant="destructive" disabled={pending} onClick={() => decide("reject")}>
              {pending ? "Rejecting…" : "Reject"}
            </Button>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setRejecting(false)}>
              Back
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button type="button" className="flex-1 sm:flex-none" disabled={pending} onClick={() => decide("approve")}>
            {pending ? "Working…" : approval.fields.some((f) => values[f.key] !== f.value) ? "Approve with edits" : "Approve"}
          </Button>
          <Button type="button" variant="outline" disabled={pending} onClick={() => setRejecting(true)}>
            Reject
          </Button>
        </div>
      )}
    </Card>
  );
}
