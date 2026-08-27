import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** "6 of 9 done" style percentage, rendered as a whole number. */
export function percent(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 100);
}

/** Completion rates are null, not zero, when nothing was assigned. */
export function rate(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return numerator / denominator;
}

export function formatRate(value: number | null, opts?: { dash?: string }): string {
  if (value === null || Number.isNaN(value)) return opts?.dash ?? "—";
  return `${Math.round(value * 100)}%`;
}

export function formatDelta(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  const points = Math.round(value * 100);
  if (points === 0) return "no change";
  return `${points > 0 ? "+" : ""}${points} pts`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}
