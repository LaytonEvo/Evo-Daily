"use client";

import { useEffect, useRef, useState } from "react";
import { Paperclip, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

type Attachment = { id: string; filename: string; contentType: string; bytes: number };
type Comment = {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; name: string };
  mine: boolean;
  attachments: Attachment[];
};

/**
 * The thread on one task occurrence.
 *
 * Loaded on first open rather than with the day — most tasks are ticked without
 * anyone ever opening this, and fetching every thread up front would be a
 * request per row for nothing.
 */
export function CommentThread({
  instanceId,
  attachmentsEnabled,
}: {
  instanceId: string;
  attachmentsEnabled: boolean;
}) {
  const { toast } = useToast();
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/instances/${instanceId}/comments`)
      .then((r) => (r.ok ? r.json() : { comments: [] }))
      .then((data) => {
        if (!cancelled) setComments(data.comments ?? []);
      })
      .catch(() => {
        if (!cancelled) setComments([]);
      });
    return () => {
      cancelled = true;
    };
  }, [instanceId]);

  async function post() {
    if (!draft.trim()) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/instances/${instanceId}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: draft.trim() }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? "Could not post that.");
      }
      const { id: commentId } = await response.json();

      for (const file of files) await upload(commentId, file);

      setDraft("");
      setFiles([]);
      await refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not post that.", { tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  /** Presign, PUT straight to the bucket, then record the row. */
  async function upload(commentId: string, file: File) {
    const meta = { filename: file.name, contentType: file.type, bytes: file.size };

    const start = await fetch(`/api/comments/${commentId}/attachments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(meta),
    });
    if (!start.ok) {
      const payload = await start.json().catch(() => ({}));
      throw new Error(payload.error ?? `Could not attach ${file.name}.`);
    }
    const { storageKey, uploadUrl } = await start.json();

    const put = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "content-type": file.type },
      body: file,
    });
    if (!put.ok) throw new Error(`Upload of ${file.name} failed.`);

    const finish = await fetch(`/api/comments/${commentId}/attachments`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...meta, storageKey }),
    });
    if (!finish.ok) throw new Error(`Could not record ${file.name}.`);
  }

  async function refresh() {
    const response = await fetch(`/api/instances/${instanceId}/comments`);
    if (response.ok) setComments((await response.json()).comments ?? []);
  }

  async function remove(id: string) {
    const response = await fetch(`/api/comments/${id}`, { method: "DELETE" });
    if (!response.ok) {
      toast("Could not delete that.", { tone: "error" });
      return;
    }
    await refresh();
  }

  return (
    <div className="mt-4 border-t pt-3">
      <p className="text-xs font-medium text-muted-foreground">
        Comments{comments ? ` (${comments.length})` : ""}
      </p>

      {comments === null ? (
        <p className="mt-2 text-sm text-muted-foreground">Loading…</p>
      ) : comments.length === 0 ? (
        <p className="mt-2 text-sm italic text-muted-foreground">Nothing yet.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-3">
          {comments.map((comment) => (
            <li key={comment.id} className="rounded-xl bg-muted/60 px-3 py-2">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-semibold">{comment.author.name}</span>
                <span className="text-xs text-muted-foreground">
                  {new Date(comment.createdAt).toLocaleString("en-GB", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                {comment.mine ? (
                  <button
                    type="button"
                    aria-label="Delete comment"
                    onClick={() => void remove(comment.id)}
                    className="ml-auto text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </div>
              <p className="mt-1 whitespace-pre-line text-sm">{comment.body}</p>
              {comment.attachments.length > 0 ? (
                <ul className="mt-2 flex flex-wrap gap-2">
                  {comment.attachments.map((file) => (
                    <li key={file.id}>
                      <a
                        href={`/api/attachments/${file.id}`}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-card px-2 py-1 text-xs hover:underline"
                      >
                        <Paperclip className="h-3 w-3" />
                        {file.filename}
                        <span className="text-muted-foreground">{formatBytes(file.bytes)}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <textarea
        rows={2}
        maxLength={2000}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Add a comment"
        className="mt-3 w-full rounded-xl border border-input bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />

      {files.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-2">
          {files.map((file, i) => (
            <li
              key={`${file.name}-${i}`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-muted px-2 py-1 text-xs"
            >
              <Paperclip className="h-3 w-3" />
              {file.name}
              <button
                type="button"
                aria-label={`Remove ${file.name}`}
                onClick={() => setFiles((current) => current.filter((_, j) => j !== i))}
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-2 flex items-center gap-2">
        <Button size="sm" disabled={!draft.trim() || busy} onClick={() => void post()}>
          {busy ? "Posting…" : "Post"}
        </Button>

        {attachmentsEnabled ? (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => fileInput.current?.click()}
              disabled={busy}
            >
              <Paperclip className="h-4 w-4" />
              Attach
            </Button>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              accept="image/*,application/pdf,text/plain,text/csv"
              onChange={(e) => {
                // Read the FileList before clearing the input. A setState
                // updater runs during the next render, by which point
                // `value = ""` has already emptied e.target.files and the
                // updater would append nothing.
                const picked = Array.from(e.target.files ?? []);
                // Cleared so picking the same file twice still fires onChange.
                e.target.value = "";
                setFiles((current) => [...current, ...picked]);
              }}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
