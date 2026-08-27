import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  compareDateOnly,
  daysBetween,
  daysInMonth,
  dueAtFor,
  endOfDayLondon,
  endOfMonthLondon,
  endOfWeekLondon,
  formatDateOnly,
  formatDateOnlyLong,
  formatTimeLondon,
  isoWeekday,
  londonTimeOn,
  ordinal,
  startOfDayLondon,
  startOfMonthLondon,
  startOfWeekLondon,
  timeNowInLondon,
  toDateOnly,
  toDbDate,
  todayInLondon,
} from "@/lib/time";

describe("todayInLondon", () => {
  it("uses the London calendar date, not UTC", () => {
    // 22:30 UTC on 27 Aug 2026 is 23:30 BST — still the 27th in London.
    expect(todayInLondon(new Date("2026-08-27T22:30:00Z"))).toBe("2026-08-27");
  });

  it("rolls over at London midnight, not UTC midnight (acceptance test 8)", () => {
    // 23:00 UTC on 27 Aug is already 00:00 BST on the 28th.
    expect(todayInLondon(new Date("2026-08-27T22:59:59Z"))).toBe("2026-08-27");
    expect(todayInLondon(new Date("2026-08-27T23:00:00Z"))).toBe("2026-08-28");
  });

  it("matches UTC in winter, when London is GMT", () => {
    expect(todayInLondon(new Date("2026-01-15T23:30:00Z"))).toBe("2026-01-15");
    expect(todayInLondon(new Date("2026-01-16T00:00:00Z"))).toBe("2026-01-16");
  });
});

describe("startOfDayLondon / endOfDayLondon", () => {
  it("resolves BST dates to the correct UTC instants", () => {
    expect(startOfDayLondon("2026-08-27").toISOString()).toBe("2026-08-26T23:00:00.000Z");
    expect(endOfDayLondon("2026-08-27").toISOString()).toBe("2026-08-27T22:59:59.999Z");
  });

  it("resolves GMT dates to the correct UTC instants", () => {
    expect(startOfDayLondon("2026-01-15").toISOString()).toBe("2026-01-15T00:00:00.000Z");
    expect(endOfDayLondon("2026-01-15").toISOString()).toBe("2026-01-15T23:59:59.999Z");
  });

  it("handles the spring-forward day (28 Mar 2027): a 23-hour day", () => {
    const start = startOfDayLondon("2027-03-28");
    const end = endOfDayLondon("2027-03-28");
    expect(start.toISOString()).toBe("2027-03-28T00:00:00.000Z");
    expect(end.toISOString()).toBe("2027-03-28T22:59:59.999Z");
    expect(end.getTime() - start.getTime()).toBeLessThan(24 * 3600 * 1000);
  });

  it("handles the autumn clock-change day (25 Oct 2026): a 25-hour day", () => {
    const start = startOfDayLondon("2026-10-25");
    const end = endOfDayLondon("2026-10-25");
    expect(start.toISOString()).toBe("2026-10-24T23:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-25T23:59:59.999Z");
    expect(end.getTime() - start.getTime()).toBeGreaterThan(24 * 3600 * 1000);
  });

  it("round-trips every day across both clock changes with no gaps or doubles", () => {
    for (const start of ["2026-10-22", "2027-03-25"]) {
      const seen = new Set<string>();
      for (let i = 0; i < 7; i += 1) {
        const date = addDays(start, i);
        seen.add(date);
        // Midday London on each date must map back to that same date.
        expect(todayInLondon(londonTimeOn(date, "12:00"))).toBe(date);
        expect(todayInLondon(startOfDayLondon(date))).toBe(date);
        expect(todayInLondon(endOfDayLondon(date))).toBe(date);
      }
      expect(seen.size).toBe(7);
    }
  });
});

describe("londonTimeOn / dueAtFor", () => {
  it("interprets HH:mm as London wall-clock time", () => {
    expect(londonTimeOn("2026-08-27", "17:30").toISOString()).toBe("2026-08-27T16:30:00.000Z");
    expect(londonTimeOn("2026-01-15", "17:30").toISOString()).toBe("2026-01-15T17:30:00.000Z");
  });

  it("falls back to the end of the day when no cut-off time is set", () => {
    expect(dueAtFor("2026-08-27", null).toISOString()).toBe("2026-08-27T22:59:59.999Z");
    expect(dueAtFor("2026-08-27", "09:00").toISOString()).toBe("2026-08-27T08:00:00.000Z");
  });

  it("rejects malformed times", () => {
    expect(() => londonTimeOn("2026-08-27", "25:00")).toThrow();
    expect(() => londonTimeOn("2026-08-27", "9:00")).toThrow();
  });
});

describe("date arithmetic", () => {
  it("adds days across month, year and DST boundaries", () => {
    expect(addDays("2026-08-31", 1)).toBe("2026-09-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("clamps months to the length of the target month", () => {
    expect(addMonths("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(addMonths("2026-08-31", 1)).toBe("2026-09-30");
  });

  it("knows the length of each month, leap years included", () => {
    expect(daysInMonth(2027, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it("computes ISO weekdays with Monday as 1", () => {
    expect(isoWeekday("2026-08-24")).toBe(1); // Monday
    expect(isoWeekday("2026-08-28")).toBe(5); // Friday
    expect(isoWeekday("2026-08-30")).toBe(7); // Sunday
  });

  it("compares and measures dates", () => {
    expect(compareDateOnly("2026-08-27", "2026-08-28")).toBeLessThan(0);
    expect(compareDateOnly("2026-08-27", "2026-08-27")).toBe(0);
    expect(daysBetween("2026-08-27", "2026-08-30")).toBe(3);
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2); // across the clock change
  });

  it("finds week and month boundaries", () => {
    expect(startOfWeekLondon("2026-08-27")).toBe("2026-08-24");
    expect(endOfWeekLondon("2026-08-27")).toBe("2026-08-30");
    expect(startOfMonthLondon("2026-08-27")).toBe("2026-08-01");
    expect(endOfMonthLondon("2026-02-10")).toBe("2026-02-28");
  });
});

describe("db date round-trips", () => {
  it("stores and reads @db.Date values without drift", () => {
    const stored = toDbDate("2026-08-27");
    expect(stored.toISOString()).toBe("2026-08-27T00:00:00.000Z");
    expect(toDateOnly(stored)).toBe("2026-08-27");
  });

  it("round-trips summer dates, where naive local parsing would slip a day", () => {
    for (const date of ["2026-06-01", "2026-10-25", "2027-03-28", "2027-01-01"]) {
      expect(toDateOnly(toDbDate(date))).toBe(date);
    }
  });

  it("rejects nonsense dates", () => {
    expect(() => toDateOnly("2026-02-30")).toThrow();
    expect(() => toDateOnly("27/08/2026")).toThrow();
  });
});

describe("formatting", () => {
  it("formats dates the way the UI shows them", () => {
    expect(formatDateOnly("2026-08-27")).toBe("Thu 27 Aug");
    expect(formatDateOnly("2026-09-01", { withYear: true })).toBe("Tue 1 Sep 2026");
    expect(formatDateOnlyLong("2026-08-27")).toBe("Thursday 27 August 2026");
  });

  it("formats instants as London wall-clock time", () => {
    expect(formatTimeLondon(new Date("2026-08-27T16:30:00Z"))).toBe("17:30");
    expect(formatTimeLondon(new Date("2026-01-15T16:30:00Z"))).toBe("16:30");
    expect(timeNowInLondon(new Date("2026-08-27T16:30:00Z"))).toBe("17:30");
  });

  it("produces ordinals", () => {
    expect(["1st", "2nd", "3rd", "11th", "21st", "22nd", "31st"]).toEqual(
      [1, 2, 3, 11, 21, 22, 31].map(ordinal),
    );
  });
});
