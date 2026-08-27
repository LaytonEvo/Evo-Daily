"use client";

import { useState } from "react";
import { InstanceStatus } from "@prisma/client";
import { Check, ChevronDown, Clock, StickyNote } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MyDayTask } from "@/lib/my-day";

/**
 * One task. The whole product lives or dies on this row: a 56px tap target, a
 * checkbox that responds instantly, no modal, no page reload.
 */
export function TaskRow({
  task,
  muted = false,
  busy = false,
  trailing,
  onToggle,
  onSaveNote,
}: {
  task: MyDayTask;
  muted?: boolean;
  busy?: boolean;
  trailing?: React.ReactNode;
  onToggle: (done: boolean, note?: string | null) => void;
  onSaveNote: (note: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [noteDraft, setNoteDraft] = useState(task.note ?? "");
  const done = task.status === InstanceStatus.COMPLETED;

  return (
    <div
      className={cn(
        "rounded-lg border bg-card shadow-sm transition-colors",
        done && "border-success/30 bg-success/5",
        muted && !done && "bg-muted/40",
      )}
    >
      <div className="flex items-stretch">
        <button
          type="button"
          role="checkbox"
          aria-checked={done}
          aria-label={done ? `Mark ${task.title} as not done` : `Mark ${task.title} as done`}
          disabled={!task.editable || busy}
          onClick={() => onToggle(!done)}
          className={cn(
            "flex w-14 shrink-0 items-center justify-center rounded-l-lg transition-colors",
            "disabled:opacity-50",
            !done && "hover:bg-accent",
          )}
        >
          <span
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-full border-2 transition-colors duration-150",
              done ? "border-success bg-success text-success-foreground" : "border-input",
            )}
          >
            {done ? <Check className="h-4 w-4" strokeWidth={3} /> : null}
          </span>
        </button>

        <div className="tap-target flex min-w-0 flex-1 items-center gap-3 py-2 pr-2">
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                "line-clamp-2 text-[15px] font-medium leading-snug",
                done && "text-muted-foreground line-through",
              )}
            >
              {task.title}
            </p>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
              {task.categoryName ? (
                <span className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: task.categoryColour ?? "#94a3b8" }}
                  />
                  {task.categoryName}
                </span>
              ) : null}
              {task.dueTimeLabel ? (
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  by {task.dueTimeLabel}
                </span>
              ) : null}
              {task.note ? (
                <span className="inline-flex items-center gap-1">
                  <StickyNote className="h-3 w-3" />
                  note
                </span>
              ) : null}
              {done && task.wasLate ? (
                <span className="font-medium text-warning">late</span>
              ) : null}
            </div>
          </div>

          {trailing}

          <button
            type="button"
            aria-label={expanded ? "Hide details" : "Show details"}
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
          >
            <ChevronDown
              className={cn(
                "h-4 w-4 transition-transform duration-150",
                expanded && "rotate-180",
              )}
            />
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="border-t px-4 py-3 animate-fade-in">
          {task.description ? (
            <p className="whitespace-pre-line text-sm text-muted-foreground">
              {task.description}
            </p>
          ) : (
            <p className="text-sm italic text-muted-foreground">No description.</p>
          )}

          <div className="mt-3">
            <label
              htmlFor={`note-${task.id}`}
              className="text-xs font-medium text-muted-foreground"
            >
              Note (optional)
            </label>
            <textarea
              id={`note-${task.id}`}
              rows={2}
              maxLength={500}
              value={noteDraft}
              disabled={!task.editable}
              onChange={(e) => setNoteDraft(e.target.value)}
              onBlur={() => {
                const next = noteDraft.trim();
                if (next !== (task.note ?? "")) onSaveNote(next === "" ? null : next);
              }}
              placeholder="Anything worth recording"
              className="mt-1 w-full rounded-md border border-input bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
        </div>
      ) : null}

    </div>
  );
}
