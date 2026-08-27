/**
 * The single source of truth for dates and times in EvoTasks.
 *
 * The whole application operates in Europe/London. Nothing else in the
 * codebase may compute a local date — no `new Date().getDate()`, no
 * `toLocaleDateString()`, no browser-zone arithmetic. If you need a calendar
 * date, it comes from here.
 *
 * Two representations are used, and they must not be confused:
 *
 *  - `DateOnly` — a "YYYY-MM-DD" string. This is a calendar date with no time
 *    and no zone. All recurrence arithmetic happens on these.
 *  - `Date` — an instant in time (stored as `timestamptz`). Prisma's `@db.Date`
 *    columns also come back as `Date`, always at UTC midnight of the calendar
 *    date; `toDateOnly` reads those back correctly.
 */

export const APP_TIMEZONE = process.env.APP_TIMEZONE || "Europe/London";

export type DateOnly = string;

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

const partsFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: APP_TIMEZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

type WallClock = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function wallClockIn(instant: Date): WallClock {
  const parts = partsFormatter.formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** Offset of the app timezone at a given instant, in milliseconds (BST = +3600000). */
function zoneOffsetMs(instant: Date): number {
  const wall = wallClockIn(instant);
  const asIfUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );
  // Drop sub-second precision on both sides so the difference is a clean offset.
  return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * Convert a London wall-clock reading to the UTC instant it denotes.
 *
 * Two passes: guess with the offset at the naive instant, then re-resolve with
 * the offset actually in force at the candidate. That settles the clock-change
 * weekends. Wall times that do not exist (01:30 on the spring-forward Sunday)
 * resolve forward into BST; times that occur twice (01:30 on the autumn
 * Sunday) resolve to the first, BST occurrence.
 */
function londonWallClockToInstant(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  ms = 0,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  let instant = naive - zoneOffsetMs(new Date(naive));
  instant = naive - zoneOffsetMs(new Date(instant));
  return new Date(instant);
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

export function isDateOnly(value: string): value is DateOnly {
  if (!DATE_ONLY_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12) return false;
  return d >= 1 && d <= daysInMonth(y, m);
}

function assertDateOnly(value: string): DateOnly {
  if (!isDateOnly(value)) {
    throw new Error(`Invalid date: expected YYYY-MM-DD, received "${value}"`);
  }
  return value;
}

export function isTimeOfDay(value: string): boolean {
  return TIME_RE.test(value);
}

/** Today's calendar date in London. The only correct way to ask "what is today?". */
export function todayInLondon(now: Date = new Date()): DateOnly {
  const wall = wallClockIn(now);
  return `${pad(wall.year, 4)}-${pad(wall.month)}-${pad(wall.day)}`;
}

/** The current London wall-clock time as "HH:mm". */
export function timeNowInLondon(now: Date = new Date()): string {
  const wall = wallClockIn(now);
  return `${pad(wall.hour)}:${pad(wall.minute)}`;
}

/**
 * Read a calendar date off a value. Accepts a `DateOnly` string, or a `Date`
 * from a Prisma `@db.Date` column (always UTC midnight of that calendar date).
 */
export function toDateOnly(value: DateOnly | Date): DateOnly {
  if (typeof value === "string") return assertDateOnly(value);
  return `${pad(value.getUTCFullYear(), 4)}-${pad(value.getUTCMonth() + 1)}-${pad(
    value.getUTCDate(),
  )}`;
}

/** The `Date` to hand Prisma for a `@db.Date` column: UTC midnight, no drift. */
export function toDbDate(value: DateOnly | Date): Date {
  const [y, m, d] = toDateOnly(value).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** 00:00:00.000 London on the given date, as a UTC instant. */
export function startOfDayLondon(value: DateOnly | Date): Date {
  const [y, m, d] = toDateOnly(value).split("-").map(Number);
  return londonWallClockToInstant(y, m, d, 0, 0, 0, 0);
}

/** 23:59:59.999 London on the given date, as a UTC instant. */
export function endOfDayLondon(value: DateOnly | Date): Date {
  const [y, m, d] = toDateOnly(value).split("-").map(Number);
  return londonWallClockToInstant(y, m, d, 23, 59, 59, 999);
}

/** "HH:mm" London on the given date, as a UTC instant. */
export function londonTimeOn(value: DateOnly | Date, time: string): Date {
  if (!isTimeOfDay(time)) {
    throw new Error(`Invalid time: expected HH:mm, received "${time}"`);
  }
  const [y, m, d] = toDateOnly(value).split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return londonWallClockToInstant(y, m, d, hh, mm, 0, 0);
}

/**
 * The cut-off instant for a due date: the template's `dueTime` if it has one,
 * otherwise the end of the day.
 */
export function dueAtFor(value: DateOnly | Date, dueTime: string | null | undefined): Date {
  return dueTime ? londonTimeOn(value, dueTime) : endOfDayLondon(value);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(value: DateOnly | Date): number {
  const [y, m, d] = toDateOnly(value).split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 ? 7 : day;
}

/** Calendar-day arithmetic. Done in UTC, so DST can never add or lose a day. */
export function addDays(value: DateOnly | Date, days: number): DateOnly {
  const [y, m, d] = toDateOnly(value).split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return toDateOnly(shifted);
}

export function addMonths(value: DateOnly | Date, months: number): DateOnly {
  const [y, m, d] = toDateOnly(value).split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const ty = target.getUTCFullYear();
  const tm = target.getUTCMonth() + 1;
  return `${pad(ty, 4)}-${pad(tm)}-${pad(Math.min(d, daysInMonth(ty, tm)))}`;
}

/** Negative when a < b, zero when equal, positive when a > b. */
export function compareDateOnly(a: DateOnly | Date, b: DateOnly | Date): number {
  const left = toDateOnly(a);
  const right = toDateOnly(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

export function minDateOnly(a: DateOnly | Date, b: DateOnly | Date): DateOnly {
  return compareDateOnly(a, b) <= 0 ? toDateOnly(a) : toDateOnly(b);
}

export function maxDateOnly(a: DateOnly | Date, b: DateOnly | Date): DateOnly {
  return compareDateOnly(a, b) >= 0 ? toDateOnly(a) : toDateOnly(b);
}

/** Whole days from `a` to `b`, e.g. daysBetween(today, tomorrow) === 1. */
export function daysBetween(a: DateOnly | Date, b: DateOnly | Date): number {
  const ms = toDbDate(b).getTime() - toDbDate(a).getTime();
  return Math.round(ms / 86_400_000);
}

/** Every date from `from` to `to` inclusive. Returns [] if the range is inverted. */
export function eachDateInRange(from: DateOnly | Date, to: DateOnly | Date): DateOnly[] {
  const start = toDateOnly(from);
  const end = toDateOnly(to);
  const dates: DateOnly[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) dates.push(d);
  return dates;
}

/** The Monday of the ISO week containing `value`. */
export function startOfWeekLondon(value: DateOnly | Date): DateOnly {
  return addDays(value, -(isoWeekday(value) - 1));
}

/** The Sunday of the ISO week containing `value`. */
export function endOfWeekLondon(value: DateOnly | Date): DateOnly {
  return addDays(value, 7 - isoWeekday(value));
}

export function startOfMonthLondon(value: DateOnly | Date): DateOnly {
  const [y, m] = toDateOnly(value).split("-").map(Number);
  return `${pad(y, 4)}-${pad(m)}-01`;
}

export function endOfMonthLondon(value: DateOnly | Date): DateOnly {
  const [y, m] = toDateOnly(value).split("-").map(Number);
  return `${pad(y, 4)}-${pad(m)}-${pad(daysInMonth(y, m))}`;
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_NAMES_LONG = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function dayName(isoDay: number, long = false): string {
  const names = long ? DAY_NAMES_LONG : DAY_NAMES;
  return names[isoDay - 1] ?? "";
}

/** "Thu 28 Aug" — the format used throughout the UI. */
export function formatDateOnly(value: DateOnly | Date, opts?: { withYear?: boolean }): string {
  const date = toDateOnly(value);
  const [y, m, d] = date.split("-").map(Number);
  const label = `${dayName(isoWeekday(date))} ${d} ${MONTH_NAMES[m - 1]}`;
  return opts?.withYear ? `${label} ${y}` : label;
}

/** "Thursday 28 August 2026" — used in the /my-day header. */
export function formatDateOnlyLong(value: DateOnly | Date): string {
  const date = toDateOnly(value);
  const [y, m, d] = date.split("-").map(Number);
  const monthLong = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    month: "long",
  }).format(new Date(Date.UTC(y, m - 1, d)));
  return `${dayName(isoWeekday(date), true)} ${d} ${monthLong} ${y}`;
}

/** An instant rendered as London wall-clock time, e.g. "17:30". */
export function formatTimeLondon(instant: Date): string {
  const wall = wallClockIn(instant);
  return `${pad(wall.hour)}:${pad(wall.minute)}`;
}

/** An ordinal day of the month, e.g. "1st", "22nd", "31st". */
export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}
