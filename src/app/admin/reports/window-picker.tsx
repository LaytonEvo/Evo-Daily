"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const PRESETS = [7, 30, 90, 365];

/**
 * The reporting window, for the org screen and for one person.
 *
 * One component with a base path rather than two near-identical ones: they
 * drifted the moment the person page got its own copy, and a picker that
 * offers different windows depending on which screen you are on is the kind
 * of difference nobody notices until they are comparing two numbers that were
 * never over the same days.
 *
 * `today` comes from the server. Asking the browser what day it is would put
 * anyone outside London on the wrong "Today" — the whole app answers that
 * question in one place and this is not it.
 */
export function WindowPicker({
  basePath,
  today,
  from,
  to,
}: {
  basePath: string;
  today: string;
  from: string;
  to: string;
}) {
  const router = useRouter();
  const params = useSearchParams();

  const paramFrom = params.get("from");
  const paramTo = params.get("to");
  const activeDays = params.get("days") ?? (paramFrom ? null : "30");
  const singleDay = paramFrom && paramFrom === paramTo ? paramFrom : null;
  const yesterday = previousDay(today);
  // Any explicit range that is not one of the two day shortcuts is a custom
  // one — including a single day months ago. Without this, picking 3 August
  // leaves no button looking selected at all.
  const isShortcut = singleDay === today || singleDay === yesterday;
  const isCustom = Boolean(paramFrom) && !isShortcut;

  const [customFrom, setCustomFrom] = useState(from);
  const [customTo, setCustomTo] = useState(to);
  const [showCustom, setShowCustom] = useState(isCustom);

  // Changing the window must not silently drop the tile filter on a person's
  // report — that would answer a different question to the one on screen.
  const filter = params.get("filter");
  const keepFilter = filter ? `&filter=${filter}` : "";

  function go(query: string) {
    router.push(`${basePath}?${query}${keepFilter}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Preset
        label="Today"
        active={singleDay === today}
        onClick={() => {
          setShowCustom(false);
          go(`from=${today}&to=${today}`);
        }}
      />
      <Preset
        label="Yesterday"
        active={singleDay === yesterday}
        onClick={() => {
          setShowCustom(false);
          go(`from=${yesterday}&to=${yesterday}`);
        }}
      />

      {PRESETS.map((days) => (
        <Preset
          key={days}
          label={days === 365 ? "1 year" : `${days} days`}
          active={activeDays === String(days)}
          onClick={() => {
            setShowCustom(false);
            go(`days=${days}`);
          }}
        />
      ))}

      <Preset
        label="Custom"
        active={isCustom || (showCustom && activeDays === null)}
        onClick={() => setShowCustom((v) => !v)}
      />

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
          <Button size="sm" onClick={() => go(`from=${customFrom}&to=${customTo}`)}>
            Apply
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Preset({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input bg-card hover:bg-accent",
      )}
    >
      {label}
    </button>
  );
}

/**
 * One day back from a YYYY-MM-DD string.
 *
 * Deliberately not `new Date(today)` minus a day: that parses as UTC midnight
 * and formats back in the browser's zone, which lands on the wrong date for
 * anyone west of London. Plain arithmetic on the parts has no timezone in it
 * at all.
 */
function previousDay(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
