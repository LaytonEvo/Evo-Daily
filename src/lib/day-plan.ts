/**
 * Laying a day out against the clock, without React.
 *
 * Pure for the same reason `dueDatesFor` is: which hours appear and what lands
 * in them are the rules worth getting right, and testing them through a
 * rendered component would only ever test them at arm's length.
 */

import type { DateOnly } from "./time";

/** The working day. The grid only grows past this to catch a stray task. */
export const DAY_START = 8;
export const DAY_END = 18;

export type PlannedTask = {
  dueDate: DateOnly;
  /** "HH:mm", or null when the task has no cut-off time. */
  dueTimeLabel: string | null;
};

export type DayLayout<T> = {
  /** Every hour row to draw, in order. Empty when nothing is timed. */
  hours: number[];
  /** Timed tasks by hour, each hour in time order. */
  byHour: Map<number, T[]>;
  /** Due today, but with no time to put them at. */
  untimed: T[];
};

export function layOutDay<T extends PlannedTask>(tasks: T[], today: DateOnly): DayLayout<T> {
  // "Done today" counts a late catch-up on an older task. That belongs in the
  // list above, but not on this clock: it was owed on a day that has already
  // been and gone.
  const mine = tasks.filter((t) => t.dueDate === today);
  const timed = mine.filter((t) => t.dueTimeLabel);
  const untimed = mine.filter((t) => !t.dueTimeLabel);

  // Nothing to place means nothing to draw. An empty grid is worse than no
  // grid: it reads as a day with nothing in it rather than a day nobody has
  // put times on.
  if (timed.length === 0) return { hours: [], byHour: new Map(), untimed };

  const taskHours = timed.map((t) => hourOf(t.dueTimeLabel!));
  const first = Math.min(DAY_START, ...taskHours);
  const last = Math.max(DAY_END, ...taskHours);

  const hours: number[] = [];
  const byHour = new Map<number, T[]>();
  for (let hour = first; hour <= last; hour++) {
    hours.push(hour);
    byHour.set(
      hour,
      timed
        .filter((t) => hourOf(t.dueTimeLabel!) === hour)
        .sort((a, b) => a.dueTimeLabel!.localeCompare(b.dueTimeLabel!)),
    );
  }

  return { hours, byHour, untimed };
}

export function hourOf(label: string): number {
  return Number(label.slice(0, 2));
}

export function minuteOf(label: string): number {
  return Number(label.slice(3, 5));
}
