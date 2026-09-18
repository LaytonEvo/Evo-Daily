"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const PRESETS = [7, 30, 90, 365];

/**
 * The window for one person's report.
 *
 * The page has always read `days`, `from` and `to` off the URL and never
 * offered a way to set them, so the only window anyone ever saw here was the
 * default thirty days. Separate from the reports-index picker because that one
 * navigates to /admin/reports and this has to stay on the person.
 */
export function PersonWindowPicker({
  userId,
  from,
  to,
}: {
  userId: string;
  from: string;
  to: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const activeDays = params.get("days") ?? (params.get("from") ? null : "30");
  const filter = params.get("filter");

  const [customFrom, setCustomFrom] = useState(from);
  const [customTo, setCustomTo] = useState(to);
  const [showCustom, setShowCustom] = useState(Boolean(params.get("from")));

  /** Changing the window must not silently drop the tile filter. */
  const keepFilter = filter ? `&filter=${filter}` : "";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {PRESETS.map((days) => (
        <button
          key={days}
          type="button"
          onClick={() => {
            setShowCustom(false);
            router.push(`/admin/reports/${userId}?days=${days}${keepFilter}`);
          }}
          className={cn(
            "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
            activeDays === String(days)
              ? "border-primary bg-primary text-primary-foreground"
              : "border-input bg-card hover:bg-accent",
          )}
        >
          {days === 365 ? "1 year" : `${days} days`}
        </button>
      ))}

      <button
        type="button"
        onClick={() => setShowCustom((v) => !v)}
        className={cn(
          "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
          showCustom && activeDays === null
            ? "border-primary bg-primary text-primary-foreground"
            : "border-input bg-card hover:bg-accent",
        )}
      >
        Custom
      </button>

      {showCustom ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="date"
            aria-label="From"
            className="h-9 w-auto"
            value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
          />
          <span className="text-sm text-muted-foreground">to</span>
          <Input
            type="date"
            aria-label="To"
            className="h-9 w-auto"
            value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
          />
          <Button
            size="sm"
            onClick={() =>
              router.push(
                `/admin/reports/${userId}?from=${customFrom}&to=${customTo}${keepFilter}`,
              )
            }
          >
            Apply
          </Button>
        </div>
      ) : null}
    </div>
  );
}
