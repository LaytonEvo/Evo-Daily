/**
 * Weeks, days, and what counts as overdue.
 *
 * The grouping is the part a screen cannot be trusted to get right by eye: a
 * week boundary in the wrong place, or a day quietly dropped, still renders as
 * a plausible list. Ordering is tested too, because "newest first" is the
 * whole reason anybody opens this rather than scrolling.
 */

import { InstanceStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { isOverdueRow, rollUpByWeek } from "@/lib/reports";

// Mon 21 Sep 2026 is a Monday; the week before runs Mon 14 – Sun 20.
const TODAY = "2026-09-23"; // Wednesday

const row = (dueDate: string, status: InstanceStatus, wasLate = false) => ({
  dueDate,
  status,
  wasLate,
});
const done = (d: string, late = false) => row(d, InstanceStatus.COMPLETED, late);
const missed = (d: string) => row(d, InstanceStatus.MISSED);
const open = (d: string) => row(d, InstanceStatus.PENDING);

describe("isOverdueRow", () => {
  it("is an open task whose day has passed, and nothing else", () => {
    expect(isOverdueRow(open("2026-09-22"), TODAY)).toBe(true);
    // Today is not overdue — the day is not finished.
    expect(isOverdueRow(open(TODAY), TODAY)).toBe(false);
    expect(isOverdueRow(missed("2026-09-10"), TODAY)).toBe(false);
    expect(isOverdueRow(done("2026-09-10"), TODAY)).toBe(false);
  });
});

describe("rollUpByWeek", () => {
  it("groups into ISO weeks, newest first", () => {
    const weeks = rollUpByWeek(
      [done("2026-09-22"), done("2026-09-16"), done("2026-09-08")],
      TODAY,
    );

    expect(weeks.map((w) => w.from)).toEqual(["2026-09-21", "2026-09-14", "2026-09-07"]);
    expect(weeks.map((w) => w.to)).toEqual(["2026-09-27", "2026-09-20", "2026-09-13"]);
  });

  it("names this week and last week, and dates the rest", () => {
    const weeks = rollUpByWeek(
      [done("2026-09-22"), done("2026-09-16"), done("2026-09-08")],
      TODAY,
    );
    expect(weeks.map((w) => w.label)).toEqual(["This week", "Last week", "7 Sep – 13 Sep"]);
  });

  it("puts a Sunday in the week that started on the Monday before it", () => {
    // The one boundary worth pinning: ISO weeks end on Sunday, and getting it
    // wrong moves a whole day's work into the wrong bucket.
    const weeks = rollUpByWeek([done("2026-09-20"), done("2026-09-21")], TODAY);
    expect(weeks).toHaveLength(2);
    expect(weeks[0]).toMatchObject({ from: "2026-09-21", label: "This week" });
    expect(weeks[1]).toMatchObject({ from: "2026-09-14", label: "Last week" });
  });

  it("orders days newest first inside a week", () => {
    const weeks = rollUpByWeek(
      [done("2026-09-21"), done("2026-09-23"), done("2026-09-22")],
      TODAY,
    );
    expect(weeks[0].days.map((d) => d.date)).toEqual([
      "2026-09-23",
      "2026-09-22",
      "2026-09-21",
    ]);
  });

  it("totals each day and each week", () => {
    const weeks = rollUpByWeek(
      [done("2026-09-22"), done("2026-09-22", true), missed("2026-09-22"), done("2026-09-21")],
      TODAY,
    );

    const [week] = weeks;
    expect(week.totals).toMatchObject({ assigned: 4, completed: 3, missed: 1, onTime: 2 });
    const [tuesday] = week.days;
    expect(tuesday.date).toBe("2026-09-22");
    expect(tuesday.totals).toMatchObject({ assigned: 3, completed: 2, missed: 1 });
  });

  it("counts the overdue ones at both levels", () => {
    const weeks = rollUpByWeek([open("2026-09-22"), open("2026-09-21"), open(TODAY)], TODAY);
    const [week] = weeks;

    // Today's open task is not overdue; the two before it are.
    expect(week.overdue).toBe(2);
    expect(week.days.find((d) => d.date === TODAY)!.overdue).toBe(0);
    expect(week.days.find((d) => d.date === "2026-09-22")!.overdue).toBe(1);
  });

  it("leaves out days nothing was due on", () => {
    const weeks = rollUpByWeek([done("2026-09-21"), done("2026-09-23")], TODAY);
    // Tuesday is absent rather than present and empty. A blank row in a list
    // is noise; a gap in the chart is the thing worth seeing.
    expect(weeks[0].days.map((d) => d.date)).toEqual(["2026-09-23", "2026-09-21"]);
  });

  it("returns nothing for nothing", () => {
    expect(rollUpByWeek([], TODAY)).toEqual([]);
  });
});
