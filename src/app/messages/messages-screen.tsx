"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CommentThread } from "@/app/my-day/comment-thread";
import { formatDateOnly } from "@/lib/time";
import { cn } from "@/lib/utils";

type Comment = {
  id: string;
  body: string;
  createdAt: string;
  authorName: string;
  mine: boolean;
  attachments: number;
};

export type ThreadRow = {
  instanceId: string;
  title: string;
  dueDate: string;
  assigneeName: string;
  assignedToMe: boolean;
  comments: Comment[];
  unread: number;
  lastAt: string;
};

/**
 * Every conversation you are in, newest first.
 *
 * Collapsed to one line each — who spoke last and what they said — because the
 * question this page answers is "has anybody said anything to me", and the
 * answer is usually a glance rather than a read. Opening one marks it read and
 * shows the full thread, which is the same component the task rows use, so
 * replying here is replying there.
 */
export function MessagesScreen({
  threads,
  attachmentsEnabled,
}: {
  threads: ThreadRow[];
  attachmentsEnabled: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(
    () => threads.find((t) => t.unread > 0)?.instanceId ?? null,
  );
  const [read, setRead] = useState<Set<string>>(new Set());

  /**
   * Whatever is open is read — including the one opened for you on arrival.
   *
   * Marking on the click alone looked right and was not: the first unread
   * thread opens by itself, so somebody could read a reply, answer it, and
   * still be told they had two unread messages. An effect on the open thread
   * catches both routes in one place.
   */
  useEffect(() => {
    if (!open) return;
    const thread = threads.find((t) => t.instanceId === open);
    if (!thread || thread.unread === 0 || read.has(open)) return;

    setRead((current) => new Set(current).add(open));
    void fetch(`/api/me/threads/${open}/read`, { method: "POST" })
      .then(() => {
        // The badge lives in the shell and reads its own count, so it is told
        // to look again rather than guessed at from here.
        router.refresh();
      })
      .catch(() => undefined);
  }, [open, threads, read, router]);

  function toggle(thread: ThreadRow) {
    setOpen(open === thread.instanceId ? null : thread.instanceId);
  }

  if (threads.length === 0) {
    return (
      <main className="mx-auto w-full max-w-2xl pb-16 pt-2">
        <div className="rounded-lg border border-dashed bg-card/50 px-4 py-12 text-center">
          <MessageSquare className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-2 text-sm font-medium">No messages yet.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Anything written on one of your tasks turns up here, however long ago it was due.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-2xl pb-16 pt-2 safe-bottom">
      <p className="mb-4 text-sm text-muted-foreground">
        Every task you own or have written on. Replies land here whatever day the task was for.
      </p>

      <div className="flex flex-col gap-2">
        {threads.map((thread) => {
          const expanded = open === thread.instanceId;
          const last = thread.comments[thread.comments.length - 1];
          const unread = read.has(thread.instanceId) ? 0 : thread.unread;

          return (
            <div
              key={thread.instanceId}
              className={cn(
                "overflow-hidden rounded-lg border bg-card",
                unread > 0 && "border-primary/40",
              )}
            >
              <button
                type="button"
                onClick={() => toggle(thread)}
                aria-expanded={expanded}
                className="flex w-full items-start gap-3 px-3 py-3 text-left hover:bg-accent/50 sm:px-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className={cn("text-sm", unread > 0 ? "font-bold" : "font-medium")}>
                      {thread.title}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDateOnly(thread.dueDate)}
                      {thread.assignedToMe ? "" : ` · ${thread.assigneeName}`}
                    </span>
                  </div>

                  {last ? (
                    <p className="mt-0.5 truncate text-sm text-muted-foreground">
                      <span className="font-medium">
                        {last.mine ? "You" : last.authorName.split(" ")[0]}:
                      </span>{" "}
                      {last.body}
                    </p>
                  ) : null}
                </div>

                <span className="flex shrink-0 items-center gap-2">
                  {unread > 0 ? <Badge>{unread} new</Badge> : null}
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <MessageSquare className="h-3.5 w-3.5" />
                    {thread.comments.length}
                  </span>
                  <ChevronDown
                    aria-hidden="true"
                    className={cn(
                      "h-4 w-4 text-muted-foreground transition-transform duration-150",
                      expanded && "rotate-180",
                    )}
                  />
                </span>
              </button>

              {expanded ? (
                <div className="border-t px-3 pb-3 sm:px-4">
                  {/* The same thread component the task rows mount, so a reply
                      written here is the same reply written there. */}
                  <CommentThread
                    instanceId={thread.instanceId}
                    attachmentsEnabled={attachmentsEnabled}
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </main>
  );
}
