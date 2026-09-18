import { describe, expect, it } from "vitest";
import { DAY_END, DAY_START, hourOf, layOutDay, minuteOf } from "@/lib/day-plan";

const TODAY = "2026-09-18";

const task = (dueTimeLabel: string | null, dueDate = TODAY) => ({ dueDate, dueTimeLabel });

describe("laying out a day", () => {
  it("draws the working day when everything falls inside it", () => {
    const { hours } = layOutDay([task("09:00"), task("16:00")], TODAY);

    expect(hours[0]).toBe(DAY_START);
    expect(hours[hours.length - 1]).toBe(DAY_END);
  });

  it("stretches early to catch a task before the working day", () => {
    const { hours, byHour } = layOutDay([task("07:30")], TODAY);

    expect(hours[0]).toBe(7);
    expect(byHour.get(7)).toHaveLength(1);
  });

  it("stretches late to catch a task after it", () => {
    const { hours, byHour } = layOutDay([task("21:00")], TODAY);

    expect(hours[hours.length - 1]).toBe(21);
    expect(byHour.get(21)).toHaveLength(1);
  });

  it("leaves no gap in the hours it draws", () => {
    const { hours } = layOutDay([task("06:00"), task("20:00")], TODAY);

    expect(hours).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  });

  it("puts two tasks in the same hour in time order", () => {
    const { byHour } = layOutDay([task("10:45"), task("10:05"), task("10:30")], TODAY);

    expect(byHour.get(10)?.map((t) => t.dueTimeLabel)).toEqual(["10:05", "10:30", "10:45"]);
  });

  it("separates the ones with no cut-off time", () => {
    const { byHour, untimed } = layOutDay([task("09:00"), task(null), task(null)], TODAY);

    expect(untimed).toHaveLength(2);
    expect(byHour.get(9)).toHaveLength(1);
  });

  it("draws nothing at all when no task has a time", () => {
    // An empty grid reads as a day with nothing in it, rather than a day
    // nobody has put times on.
    const { hours, untimed } = layOutDay([task(null), task(null)], TODAY);

    expect(hours).toEqual([]);
    expect(untimed).toHaveLength(2);
  });

  it("ignores a task owed on an earlier day", () => {
    // "Done today" counts a late catch-up on an older task. It belongs in that
    // list, but not on today's clock.
    const yesterday = task("09:00", "2026-09-17");
    const { byHour, untimed } = layOutDay([task("09:00"), yesterday, task(null, "2026-09-17")], TODAY);

    expect(byHour.get(9)).toHaveLength(1);
    expect(untimed).toEqual([]);
  });

  it("returns nothing when the whole day belongs to another date", () => {
    const { hours, untimed } = layOutDay([task("09:00", "2026-09-17")], TODAY);

    expect(hours).toEqual([]);
    expect(untimed).toEqual([]);
  });

  it("reads an hour and a minute off a label", () => {
    expect(hourOf("07:05")).toBe(7);
    expect(minuteOf("07:05")).toBe(5);
    expect(hourOf("23:59")).toBe(23);
    expect(minuteOf("23:59")).toBe(59);
  });
});
