"use client";

import { useState, Children } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/** A /my-day section. Collapsed if empty — an empty heading is just noise. */
export function Section({
  title,
  count,
  description,
  tone = "default",
  collapsedByDefault = false,
  children,
}: {
  title: string;
  count: number;
  description?: string;
  tone?: "default" | "danger" | "muted" | "success";
  collapsedByDefault?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!collapsedByDefault);

  if (count === 0 || Children.count(children) === 0) return null;

  const heading = (
    <div className="flex items-center gap-2">
      <h2
        className={cn(
          "text-sm font-semibold uppercase tracking-wide",
          tone === "danger" && "text-destructive",
          tone === "muted" && "text-muted-foreground",
          tone === "success" && "text-success",
          tone === "default" && "text-foreground",
        )}
      >
        {title}
      </h2>
      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground tabular-nums">
        {count}
      </span>
    </div>
  );

  return (
    <section>
      {collapsedByDefault ? (
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 py-1"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {heading}
          <ChevronDown
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform duration-150",
              open && "rotate-180",
            )}
          />
        </button>
      ) : (
        <div className="py-1">
          {heading}
          {description ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
      )}

      {open ? <div className="mt-2 flex flex-col gap-2">{children}</div> : null}
    </section>
  );
}
