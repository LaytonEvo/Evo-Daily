"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

type Impact = {
  id: string;
  title: string;
  recorded: number;
  comments: number;
  attachments: number;
  clean: boolean;
};

/**
 * Deleting a selection.
 *
 * It asks the server what the delete would cost before offering to do it, so
 * the decision is made against the real numbers rather than a general warning.
 * The tasks nothing has happened to go on a single confirmation; the ones
 * carrying a record are listed by name with their day counts, and take a
 * separate tick that says what is being accepted.
 */
export function DeleteDrawer({
  templateIds,
  onClose,
  onDeleted,
}: {
  templateIds: string[];
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { toast } = useToast();
  const [impacts, setImpacts] = useState<Impact[] | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/templates/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "impact", templateIds }),
    })
      .then((r) => (r.ok ? r.json() : { impacts: [] }))
      .then((data) => {
        if (!cancelled) setImpacts(data.impacts ?? []);
      })
      .catch(() => {
        if (!cancelled) setError("Could not work out what these would remove.");
      });
    return () => {
      cancelled = true;
    };
  }, [templateIds]);

  const withRecord = impacts?.filter((i) => !i.clean) ?? [];
  const clean = impacts?.filter((i) => i.clean) ?? [];
  const recordedDays = withRecord.reduce((sum, i) => sum + i.recorded, 0);
  const needsAcceptance = withRecord.length > 0;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/templates/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "delete",
          templateIds,
          // Never sent unless the tick was made, and the server refuses
          // recorded tasks without it either way.
          force: needsAcceptance && accepted,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not delete those.");
      }
      const body = (await response.json()) as { deleted: number; blocked: Impact[] };
      const kept = body.blocked?.length ?? 0;
      toast(
        `${body.deleted} task${body.deleted === 1 ? "" : "s"} deleted` +
          (kept > 0 ? `. ${kept} kept — ${kept === 1 ? "it has" : "they have"} a record.` : "."),
      );
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete those.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30 animate-fade-in" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Delete ${templateIds.length} tasks`}
        className="relative flex h-full w-full max-w-md flex-col bg-card shadow-xl animate-slide-up sm:animate-fade-in"
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="font-semibold">
            Delete {templateIds.length} task{templateIds.length === 1 ? "" : "s"}
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-md p-2 hover:bg-accent"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {impacts === null ? (
            <p className="text-sm text-muted-foreground">Working out what this removes…</p>
          ) : impacts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing to delete.</p>
          ) : (
            <div className="flex flex-col gap-4">
              {clean.length > 0 ? (
                <div>
                  <p className="text-sm font-medium">
                    {clean.length} with no record
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Nothing has happened to {clean.length === 1 ? "this one" : "these"}. Deleting
                    changes no report.
                  </p>
                  <ul className="mt-2 flex flex-col divide-y rounded-lg border">
                    {clean.map((impact) => (
                      <li key={impact.id} className="truncate px-3 py-2 text-sm">
                        {impact.title}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {withRecord.length > 0 ? (
                <div>
                  <p className="inline-flex items-center gap-1.5 text-sm font-medium text-destructive">
                    <AlertTriangle className="h-4 w-4" />
                    {withRecord.length} with history
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {recordedDays} recorded day{recordedDays === 1 ? "" : "s"} would go, with every
                    comment and attachment on them. Completion rates that counted those days will
                    change, including in reports already sent.
                  </p>
                  <ul className="mt-2 flex flex-col divide-y rounded-lg border border-destructive/30">
                    {withRecord.map((impact) => (
                      <li
                        key={impact.id}
                        className="flex items-center gap-2 px-3 py-2 text-sm"
                      >
                        <span className="min-w-0 flex-1 truncate">{impact.title}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {impact.recorded} day{impact.recorded === 1 ? "" : "s"}
                          {impact.comments > 0
                            ? ` · ${impact.comments} comment${impact.comments === 1 ? "" : "s"}`
                            : ""}
                        </span>
                      </li>
                    ))}
                  </ul>

                  <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4"
                      checked={accepted}
                      onChange={(e) => setAccepted(e.target.checked)}
                    />
                    <span>
                      I accept that past reports will change. Delete{" "}
                      {withRecord.length === 1 ? "this one" : "these"} too.
                    </span>
                  </label>
                  {!accepted ? (
                    <p className="mt-1 pl-6 text-xs text-muted-foreground">
                      Leave it unticked and {withRecord.length === 1 ? "it stays" : "they stay"} —
                      only the {clean.length} with no record will go.
                    </p>
                  ) : null}
                </div>
              ) : null}

              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 border-t px-4 py-3">
          <Button
            type="button"
            variant="destructive"
            disabled={busy || impacts === null || impacts.length === 0 || (needsAcceptance && !accepted && clean.length === 0)}
            onClick={() => void submit()}
          >
            {busy
              ? "Deleting…"
              : !needsAcceptance || accepted
                ? `Delete ${impacts?.length ?? 0}`
                : clean.length > 0
                  ? `Delete ${clean.length}`
                  : // Everything selected has a record, so without the tick
                    // there is nothing this button could do. "Delete 0" is a
                    // button offering to do nothing.
                    "Accept to delete"}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
