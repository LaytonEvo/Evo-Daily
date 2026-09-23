/**
 * How far ahead a task shows up on its owner's day.
 *
 * A daily task needs no warning: it appears in the morning and is done by the
 * evening. A monthly one lands at midnight on its due date and, with a
 * one-day catch-up window, is missed by the following night — a stocktake
 * with a single working day of notice, most of which is spent not knowing
 * about it. The task is not late because somebody was lazy; it is late
 * because the screen never mentioned it until the morning it was due.
 *
 * So a task says how much notice it wants, and null means "whatever suits
 * this frequency". Null rather than a number-with-a-default because the
 * sensible answer differs per task — a monthly deep clean wants a week, a
 * monthly invoice run wants a day — and the person writing the task is the
 * one who knows. The defaults are there so nobody has to decide.
 */

import { Frequency } from "@prisma/client";

export const DEFAULT_LEAD_DAYS: Record<Frequency, number> = {
  [Frequency.DAILY]: 0,
  [Frequency.WEEKLY]: 2,
  [Frequency.MONTHLY]: 5,
  // A one-off is a monthly task that happens once. Same problem, same answer.
  [Frequency.ONE_OFF]: 2,
};

/** Never show work further out than this, whatever a task asks for. */
export const MAX_LEAD_DAYS = 30;

export function leadDaysFor(template: {
  frequency: Frequency;
  leadDays?: number | null;
}): number {
  const asked = template.leadDays ?? DEFAULT_LEAD_DAYS[template.frequency];
  return Math.min(Math.max(0, asked), MAX_LEAD_DAYS);
}

/** Describes the setting in the words the form uses. */
export function describeLead(days: number): string {
  if (days === 0) return "On the day";
  if (days === 1) return "1 day before";
  return `${days} days before`;
}
