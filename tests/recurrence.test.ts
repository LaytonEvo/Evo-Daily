import { describe, expect, it } from "vitest";
import { Frequency } from "@prisma/client";
import {
  DEFAULT_DAYS_OF_WEEK,
  describeSchedule,
  dueDatesFor,
  nextDueDates,
  type Schedule,
} from "@/lib/recurrence";

function schedule(overrides: Partial<Schedule>): Schedule {
  return {
    frequency: Frequency.DAILY,
    daysOfWeek: DEFAULT_DAYS_OF_WEEK,
    dayOfWeek: null,
    dayOfMonth: null,
    startDate: "2020-01-01",
    endDate: null,
    ...overrides,
  };
}

describe("DAILY", () => {
  it("generates exactly 5 instances in a Mon–Sun window, none at the weekend (acceptance test 1)", () => {
    // Mon 24 Aug 2026 – Sun 30 Aug 2026.
    const dates = dueDatesFor(
      schedule({ daysOfWeek: [1, 2, 3, 4, 5] }),
      "2026-08-24",
      "2026-08-30",
    );
    expect(dates).toEqual([
      "2026-08-24",
      "2026-08-25",
      "2026-08-26",
      "2026-08-27",
      "2026-08-28",
    ]);
  });

  it("fires seven days a week only when explicitly set to", () => {
    const dates = dueDatesFor(
      schedule({ daysOfWeek: [1, 2, 3, 4, 5, 6, 7] }),
      "2026-08-24",
      "2026-08-30",
    );
    expect(dates).toHaveLength(7);
  });

  it("defaults to Mon–Fri when no days are given", () => {
    const dates = dueDatesFor(schedule({ daysOfWeek: [] }), "2026-08-24", "2026-08-30");
    expect(dates).toHaveLength(5);
  });

  it("supports weekend-only and single-day schedules", () => {
    expect(dueDatesFor(schedule({ daysOfWeek: [6, 7] }), "2026-08-24", "2026-08-30")).toEqual([
      "2026-08-29",
      "2026-08-30",
    ]);
    expect(dueDatesFor(schedule({ daysOfWeek: [3] }), "2026-08-24", "2026-09-06")).toEqual([
      "2026-08-26",
      "2026-09-02",
    ]);
  });

  it("produces exactly one instance per day across both clock changes (acceptance test 9)", () => {
    for (const [from, to] of [
      ["2026-10-22", "2026-10-28"],
      ["2027-03-25", "2027-03-31"],
    ]) {
      const dates = dueDatesFor(schedule({ daysOfWeek: [1, 2, 3, 4, 5, 6, 7] }), from, to);
      expect(dates).toHaveLength(7);
      expect(new Set(dates).size).toBe(7); // no doubles
      // No gaps: consecutive calendar dates.
      expect(dates[0]).toBe(from);
      expect(dates[6]).toBe(to);
    }
  });
});

describe("WEEKLY", () => {
  it("generates exactly 4 instances over a 4-week window (acceptance test 3)", () => {
    const dates = dueDatesFor(
      schedule({ frequency: Frequency.WEEKLY, dayOfWeek: 1 }),
      "2026-08-24",
      "2026-09-20",
    );
    expect(dates).toEqual(["2026-08-24", "2026-08-31", "2026-09-07", "2026-09-14"]);
  });

  it("finds the first matching weekday when the window starts mid-week", () => {
    const dates = dueDatesFor(
      schedule({ frequency: Frequency.WEEKLY, dayOfWeek: 5 }),
      "2026-08-26",
      "2026-09-10",
    );
    expect(dates).toEqual(["2026-08-28", "2026-09-04"]);
  });

  it("returns nothing without a day of week", () => {
    expect(
      dueDatesFor(schedule({ frequency: Frequency.WEEKLY, dayOfWeek: null }), "2026-08-24", "2026-09-24"),
    ).toEqual([]);
  });
});

describe("MONTHLY", () => {
  it("clamps day 31 to the last day of each month (acceptance test 2)", () => {
    const dates = dueDatesFor(
      schedule({ frequency: Frequency.MONTHLY, dayOfMonth: 31 }),
      "2027-02-01",
      "2027-04-30",
    );
    expect(dates).toEqual(["2027-02-28", "2027-03-31", "2027-04-30"]);
  });

  it("clamps to 29 February in a leap year", () => {
    const dates = dueDatesFor(
      schedule({ frequency: Frequency.MONTHLY, dayOfMonth: 30 }),
      "2028-02-01",
      "2028-02-29",
    );
    expect(dates).toEqual(["2028-02-29"]);
  });

  it("generates the 1st of each month", () => {
    const dates = dueDatesFor(
      schedule({ frequency: Frequency.MONTHLY, dayOfMonth: 1 }),
      "2026-08-15",
      "2026-11-15",
    );
    expect(dates).toEqual(["2026-09-01", "2026-10-01", "2026-11-01"]);
  });

  it("includes an occurrence falling on the first day of the window", () => {
    const dates = dueDatesFor(
      schedule({ frequency: Frequency.MONTHLY, dayOfMonth: 15 }),
      "2026-08-15",
      "2026-08-15",
    );
    expect(dates).toEqual(["2026-08-15"]);
  });

  it("skips a month whose occurrence falls before the window opens", () => {
    const dates = dueDatesFor(
      schedule({ frequency: Frequency.MONTHLY, dayOfMonth: 5 }),
      "2026-08-10",
      "2026-09-30",
    );
    expect(dates).toEqual(["2026-09-05"]);
  });
});

describe("ONE_OFF", () => {
  it("generates a single instance on the start date", () => {
    const dates = dueDatesFor(
      schedule({ frequency: Frequency.ONE_OFF, startDate: "2026-09-03" }),
      "2026-08-24",
      "2026-09-30",
    );
    expect(dates).toEqual(["2026-09-03"]);
  });

  it("generates nothing outside the window", () => {
    expect(
      dueDatesFor(
        schedule({ frequency: Frequency.ONE_OFF, startDate: "2026-09-03" }),
        "2026-09-04",
        "2026-09-30",
      ),
    ).toEqual([]);
  });
});

describe("window and lifecycle clipping", () => {
  it("generates nothing for a template whose endDate is in the past (acceptance test 5)", () => {
    const dates = dueDatesFor(
      schedule({ startDate: "2026-01-01", endDate: "2026-06-30", daysOfWeek: [1, 2, 3, 4, 5] }),
      "2026-08-24",
      "2026-08-28",
    );
    expect(dates).toEqual([]);
  });

  it("generates nothing before the start date", () => {
    const dates = dueDatesFor(
      schedule({ startDate: "2026-08-26", daysOfWeek: [1, 2, 3, 4, 5] }),
      "2026-08-24",
      "2026-08-28",
    );
    expect(dates).toEqual(["2026-08-26", "2026-08-27", "2026-08-28"]);
  });

  it("stops on the end date inclusive", () => {
    const dates = dueDatesFor(
      schedule({ startDate: "2026-08-24", endDate: "2026-08-26", daysOfWeek: [1, 2, 3, 4, 5] }),
      "2026-08-24",
      "2026-08-28",
    );
    expect(dates).toEqual(["2026-08-24", "2026-08-25", "2026-08-26"]);
  });

  it("returns nothing for an inverted window", () => {
    expect(dueDatesFor(schedule({}), "2026-08-28", "2026-08-24")).toEqual([]);
  });

  it("accepts Date objects as well as date strings", () => {
    const dates = dueDatesFor(
      schedule({ startDate: new Date(Date.UTC(2026, 7, 26)) }),
      new Date(Date.UTC(2026, 7, 24)),
      new Date(Date.UTC(2026, 7, 28)),
    );
    expect(dates).toEqual(["2026-08-26", "2026-08-27", "2026-08-28"]);
  });

  it("is deterministic — the same inputs always give the same dates", () => {
    const s = schedule({ frequency: Frequency.MONTHLY, dayOfMonth: 31 });
    const first = dueDatesFor(s, "2026-01-01", "2027-12-31");
    for (let i = 0; i < 4; i += 1) {
      expect(dueDatesFor(s, "2026-01-01", "2027-12-31")).toEqual(first);
    }
  });
});

describe("nextDueDates", () => {
  it("previews the next three dates for a weekday schedule", () => {
    expect(nextDueDates(schedule({ daysOfWeek: [1, 2, 3, 4, 5] }), 3, "2026-08-27")).toEqual([
      "2026-08-27",
      "2026-08-28",
      "2026-08-31",
    ]);
  });

  it("previews far enough ahead for a monthly schedule", () => {
    expect(
      nextDueDates(schedule({ frequency: Frequency.MONTHLY, dayOfMonth: 1 }), 3, "2026-08-27"),
    ).toEqual(["2026-09-01", "2026-10-01", "2026-11-01"]);
  });

  it("returns fewer dates when the template ends", () => {
    expect(
      nextDueDates(
        schedule({ daysOfWeek: [1, 2, 3, 4, 5], endDate: "2026-08-28" }),
        3,
        "2026-08-27",
      ),
    ).toEqual(["2026-08-27", "2026-08-28"]);
  });
});

describe("describeSchedule", () => {
  it("renders schedules the way a human would say them", () => {
    expect(describeSchedule(schedule({ daysOfWeek: [1, 2, 3, 4, 5] }))).toBe("Every weekday");
    expect(describeSchedule(schedule({ daysOfWeek: [1, 2, 3, 4, 5, 6, 7] }))).toBe("Every day");
    expect(describeSchedule(schedule({ daysOfWeek: [6, 7] }))).toBe("Weekends");
    expect(describeSchedule(schedule({ daysOfWeek: [1, 3] }))).toBe("Every Mon, Wed");
    expect(describeSchedule(schedule({ frequency: Frequency.WEEKLY, dayOfWeek: 1 }))).toBe(
      "Every Monday",
    );
    expect(describeSchedule(schedule({ frequency: Frequency.MONTHLY, dayOfMonth: 1 }))).toBe(
      "1st of the month",
    );
    expect(describeSchedule(schedule({ frequency: Frequency.MONTHLY, dayOfMonth: 22 }))).toBe(
      "22nd of the month",
    );
    expect(describeSchedule(schedule({ frequency: Frequency.ONE_OFF }))).toBe("One-off");
  });
});
