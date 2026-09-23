"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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
  inThread: boolean;
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
  readOnly = false,
  unreadBy,
  scope,
}: {
  threads: ThreadRow[];
  attachmentsEnabled: boolean;
  /**
   * Somebody else's inbox, being looked at. No composer, and — the part that
   * matters — no marking anything read. These are not the reader's threads,
   * and quietly clearing their own badge from a screen they are only watching
   * is a count that lies.
   */
  readOnly?: boolean;
  /** Whose unread this is, when it is not the reader's own. */
  unreadBy?: string;
  /**
   * Present for admins, who can read the whole team's conversations as well as
   * their own. Absent for everybody else, and for the view-as screen, which is
   * one person's inbox by definition.
   */
  scope?: "mine" | "all";
}) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(() =>
    readOnly ? null : (threads.find((t) => t.unread > 0)?.instanceId ?? null),
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
    if (readOnly || !open) return;
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
  }, [open, threads, read, router, readOnly]);

  function toggle(thread: ThreadRow) {
    setOpen(open === thread.instanceId ? null : thread.instanceId);
  }

  const tabs = scope ? (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <ScopeTab href="/messages" active={scope === "mine"} label="Mine" />
      <ScopeTab href="/messages?scope=all" active={scope === "all"} label="Everyone" />
      {scope === "all" ? (
        <span className="text-xs text-muted-foreground">
          Every conversation in the team. Only the ones you are in are counted as unread.
        </span>
      ) : null}
    </div>
  ) : null;

  if (threads.length === 0) {
    return (
      <main className="mx-auto w-full max-w-2xl pb-16 pt-2">
        {tabs}
        <div className="rounded-lg border border-dashed bg-card/50 px-4 py-12 text-center">
          <MessageSquare className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-2 text-sm font-medium">No messages yet.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {readOnly
              ? "Nothing has been written on their tasks yet."
              : "Anything written on one of your tasks turns up here, however long ago it was due."}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-2xl pb-16 pt-2 safe-bottom">
      {tabs}
      <p className="mb-4 text-sm text-muted-foreground">
        {readOnly
          ? `Every conversation on ${unreadBy ? `${unreadBy}'s` : "their"} tasks, as they see it. Reply from the task itself or from your own Messages — a comment written here would be from you, not them, and this screen is for reading.`
          : scope === "all"
            ? "Every task in the team that anybody has written on."
            : "Every task you own or have written on. Replies land here whatever day the task was for."}
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
                        {/* "You" is only true when these are your own
                            threads. On somebody else's inbox the reader is not
                            the person `mine` refers to, so everyone gets a
                            name. */}
                        {last.mine && !readOnly ? "You" : last.authorName.split(" ")[0]}:
                      </span>{" "}
                      {last.body}
                    </p>
                  ) : null}
                </div>

                <span className="flex shrink-0 items-center gap-2">
                  {unread > 0 ? (
                    <Badge>
                      {unread} {readOnly ? `unread by ${unreadBy ?? "them"}` : "new"}
                    </Badge>
                  ) : null}
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
                    readOnly={readOnly}
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

function ScopeTab({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input bg-card hover:bg-accent",
      )}
    >
      {label}
    </Link>
  );
}
