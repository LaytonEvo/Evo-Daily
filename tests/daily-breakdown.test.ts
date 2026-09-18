/**
 * The per-day chart data.
 *
 * Pure, and tested as such: the shape of a chart is hard to assert on and easy
 * to get subtly wrong — an empty day dropped, a running total that only counts
 * what happens to be on screen — and both mistakes read as a plausible graph.
 */

import { InstanceStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { dailyBreakdown, type DatedInstance } from "@/lib/reports";

const done = (dueDate: string, wasLate = false): DatedInstance => ({
  dueDate,
  status: InstanceStatus.COMPLETED,
  wasLate,
});
const missed = (dueDate: string): DatedInstance => ({
  dueDate,
  status: InstanceStatus.MISSED,
  wasLate: false,
});
const excused = (dueDate: string): DatedInstance => ({
  dueDate,
  status: InstanceStatus.EXCUSED,
  wasLate: false,
});

describe("dailyBreakdown", () => {
  it("counts completed, missed and late for each day", () => {
    const days = dailyBreakdown(
      [done("2026-09-14"), done("2026-09-14", true), missed("2026-09-14"), done("2026-09-15")],
      { from: "2026-09-14", to: "2026-09-15" },
    );

    expect(days).toHaveLength(2);
    expect(days[0]).toMatchObject({
      date: "2026-09-14",
      completed: 2,
      late: 1,
      missed: 1,
      assigned: 3,
    });
    expect(days[1]).toMatchObject({ date: "2026-09-15", completed: 1, missed: 0, assigned: 1 });
  });

  it("keeps the days nothing was due", () => {
    const days = dailyBreakdown([done("2026-09-14"), done("2026-09-18")], {
      from: "2026-09-14",
      to: "2026-09-18",
    });

    // Five columns, not two. A fortnight off should look like a fortnight off.
    expect(days.map((d) => d.date)).toEqual([
      "2026-09-14",
      "2026-09-15",
      "2026-09-16",
      "2026-09-17",
      "2026-09-18",
    ]);
    expect(days[1]).toMatchObject({ completed: 0, missed: 0, assigned: 0 });
  });

  it("leaves excused days out of what was owed", () => {
    const [day] = dailyBreakdown([done("2026-09-14"), excused("2026-09-14")], {
      from: "2026-09-14",
      to: "2026-09-14",
    });
    expect(day.assigned).toBe(1);
    expect(day.completed).toBe(1);
  });

  it("runs the week total over seven days including the day itself", () => {
    const rows = ["09-08", "09-09", "09-10", "09-11", "09-12", "09-13", "09-14"].map((d) =>
      done(`2026-${d}`),
    );
    const days = dailyBreakdown(rows, { from: "2026-09-14", to: "2026-09-14" });
    expect(days[0].weekCompleted).toBe(7);

    // The eighth day back has rolled out of it.
    const withOlder = dailyBreakdown([...rows, done("2026-09-07")], {
      from: "2026-09-14",
      to: "2026-09-14",
    });
    expect(withOlder[0].weekCompleted).toBe(7);
  });

  it("counts a running week from rows before the window, not just the ones drawn", () => {
    // The first column of any chart is the one nearest the eye. If the running
    // total only saw what was on screen it would read 1 here, not 4.
    const days = dailyBreakdown(
      [missed("2026-09-11"), missed("2026-09-12"), missed("2026-09-13"), missed("2026-09-14")],
      { from: "2026-09-14", to: "2026-09-14" },
    );
    expect(days[0].missed).toBe(1);
    expect(days[0].weekMissed).toBe(4);
  });

  it("returns a row per day even with no instances at all", () => {
    const days = dailyBreakdown([], { from: "2026-09-14", to: "2026-09-16" });
    expect(days).toHaveLength(3);
    expect(days.every((d) => d.assigned === 0)).toBe(true);
  });
});
