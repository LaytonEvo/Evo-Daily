/**
 * Work that is not due yet.
 *
 * Two problems, one mechanism. A monthly task used to appear at midnight on
 * the day it was due and be missed the next night; and a day cleared by
 * lunchtime showed nothing else, with a fortnight of generated work sitting
 * in the database unseen.
 *
 * The rules worth pinning are the boundaries: a task appears the day its lead
 * time is reached and not before, nothing ahead is ever counted as owed
 * today, and finishing one early leaves a trace rather than making it vanish.
 */

import { Frequency, InstanceStatus } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createTemplate,
  databaseAvailable,
  instancesFor,
  prisma,
  seedFixture,
  type Fixture,
} from "./helpers/db";
import { generateInstances } from "@/lib/recurrence";
import { getComingUp, getMyDay } from "@/lib/my-day";
import { DEFAULT_LEAD_DAYS, leadDaysFor } from "@/lib/lead-time";
import { addDays, toDateOnly } from "@/lib/time";

const available = await databaseAvailable();
const describeDb = available ? describe : describe.skip;

const TODAY = "2026-09-23"; // Wednesday

describe("leadDaysFor", () => {
  it("falls back to something sensible per frequency", () => {
    expect(leadDaysFor({ frequency: Frequency.DAILY, leadDays: null })).toBe(0);
    expect(leadDaysFor({ frequency: Frequency.WEEKLY, leadDays: null })).toBe(
      DEFAULT_LEAD_DAYS[Frequency.WEEKLY],
    );
    expect(leadDaysFor({ frequency: Frequency.MONTHLY, leadDays: null })).toBe(5);
  });

  it("lets a task say nothing rather than inherit a default", () => {
    // Explicit zero is a real answer, and `?? default` would swallow it.
    expect(leadDaysFor({ frequency: Frequency.MONTHLY, leadDays: 0 })).toBe(0);
  });

  it("clamps anything absurd", () => {
    expect(leadDaysFor({ frequency: Frequency.MONTHLY, leadDays: 400 })).toBe(30);
    expect(leadDaysFor({ frequency: Frequency.MONTHLY, leadDays: -3 })).toBe(0);
  });
});

describeDb("coming up", () => {
  let fixture: Fixture;
  const who = () => ({ id: fixture.memberId, organisationId: fixture.orgId });

  beforeEach(async () => {
    fixture = await seedFixture({ graceDays: 1 });
  });

  /** A one-off due `inDays` from today, with an explicit lead time. */
  async function scheduled(title: string, inDays: number, leadDays: number | null) {
    const due = addDays(TODAY, inDays);
    const template = await createTemplate(fixture, {
      title,
      frequency: Frequency.ONE_OFF,
      startDate: due,
      endDate: due,
      assigneeId: fixture.memberId,
    });
    await prisma.taskTemplate.update({ where: { id: template.id }, data: { leadDays } });
    await generateInstances(prisma, TODAY, addDays(TODAY, 20));
    return template;
  }

  it("flags a task once its lead time is reached and not before", async () => {
    await scheduled("Monthly stocktake", 5, 5);
    await scheduled("Next month's stocktake", 9, 5);

    const ahead = await getComingUp(prisma, who(), TODAY);
    const byTitle = new Map(ahead.map((t) => [t.title, t]));

    expect(byTitle.get("Monthly stocktake")?.withinLead).toBe(true);
    // Nine days out with five days of notice: known about, not yet shown.
    expect(byTitle.get("Next month's stocktake")?.withinLead).toBe(false);
  });

  it("never treats anything ahead as late", async () => {
    await scheduled("Due next week", 6, 7);
    const [task] = await getComingUp(prisma, who(), TODAY);
    expect(task.daysLate).toBe(0);
    expect(task.upcoming).toBe(true);
  });

  it("keeps today's work out of it and its own work out of today", async () => {
    await createTemplate(fixture, {
      title: "Due today",
      startDate: TODAY,
      frequency: Frequency.ONE_OFF,
      endDate: TODAY,
      assigneeId: fixture.memberId,
    });
    await scheduled("Due Friday", 2, 7);

    const day = await getMyDay(prisma, who(), TODAY);

    expect(day.dueToday.map((t) => t.title)).toEqual(["Due today"]);
    expect(day.comingUp.map((t) => t.title)).toEqual(["Due Friday"]);
    // The ring is today's. Work that is not due cannot make it look worse.
    expect(day.owedTotal).toBe(1);
  });

  it("never pulls a daily task forward", async () => {
    // Tomorrow's ball count is a different count. Doing it today helps
    // nobody, and four of them would bury the weekly check underneath.
    await createTemplate(fixture, {
      title: "Record range ball stock level",
      startDate: addDays(TODAY, -5),
      frequency: Frequency.DAILY,
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
      assigneeId: fixture.memberId,
    });
    await scheduled("Weekly range check", 2, 2);
    await generateInstances(prisma, TODAY, addDays(TODAY, 20));

    const ahead = await getComingUp(prisma, who(), TODAY);
    expect(ahead.map((t) => t.title)).toEqual(["Weekly range check"]);
  });

  it("honours an explicit zero on a task that would otherwise get notice", async () => {
    await scheduled("Monthly, but no warning wanted", 3, 0);
    expect(await getComingUp(prisma, who(), TODAY)).toEqual([]);
  });

  it("stops at the end of the fortnight generation reaches", async () => {
    await scheduled("Three weeks out", 21, 30);
    const ahead = await getComingUp(prisma, who(), TODAY);
    expect(ahead.map((t) => t.title)).not.toContain("Three weeks out");
  });

  it("leaves out anything already completed", async () => {
    const template = await scheduled("Due Friday", 2, 7);
    const [instance] = await instancesFor(template.id);
    await prisma.taskInstance.update({
      where: { id: instance.id },
      data: { status: InstanceStatus.COMPLETED, completedAt: new Date() },
    });

    expect(await getComingUp(prisma, who(), TODAY)).toEqual([]);
  });

  it("shows a task finished early as done today rather than losing it", async () => {
    // The trap: getMyDay only ever looked back, so ticking Friday's task on
    // Wednesday removed it from the screen with no Done row and no ring
    // movement. Work that disappears when you do it is how people stop
    // trusting a screen.
    const template = await scheduled("Due Friday", 2, 7);
    const [instance] = await instancesFor(template.id);
    await prisma.taskInstance.update({
      where: { id: instance.id },
      data: { status: InstanceStatus.COMPLETED, completedAt: new Date() },
    });

    const day = await getMyDay(prisma, who(), TODAY);
    expect(day.doneToday.map((t) => t.title)).toContain("Due Friday");
    expect(day.comingUp).toEqual([]);
  });

  it("does not let work done early flatter today's progress ring", async () => {
    await createTemplate(fixture, {
      title: "Due today",
      startDate: TODAY,
      frequency: Frequency.ONE_OFF,
      endDate: TODAY,
      assigneeId: fixture.memberId,
    });
    const ahead = await scheduled("Due Friday", 2, 7);
    await generateInstances(prisma, TODAY, addDays(TODAY, 20));

    const before = await getMyDay(prisma, who(), TODAY);
    expect([before.owedDone, before.owedTotal]).toEqual([0, 1]);

    const [instance] = await instancesFor(ahead.id);
    await prisma.taskInstance.update({
      where: { id: instance.id },
      data: { status: InstanceStatus.COMPLETED, completedAt: new Date() },
    });

    const after = await getMyDay(prisma, who(), TODAY);
    // It shows as done, because it was done. It is not part of today's total.
    expect(after.doneToday.map((t) => t.title)).toContain("Due Friday");
    expect([after.owedDone, after.owedTotal]).toEqual([0, 1]);
  });

  it("does not resurrect something completed on an earlier day", async () => {
    const template = await scheduled("Due Friday", 2, 7);
    const [instance] = await instancesFor(template.id);
    await prisma.taskInstance.update({
      where: { id: instance.id },
      data: {
        status: InstanceStatus.COMPLETED,
        completedAt: new Date(`${addDays(TODAY, -3)}T10:00:00Z`),
      },
    });

    const day = await getMyDay(prisma, who(), TODAY);
    expect(day.doneToday.map((t) => t.title)).not.toContain("Due Friday");
  });

  it("shows the next occurrence of a task, not every one", async () => {
    await createTemplate(fixture, {
      title: "Weekly range check",
      startDate: addDays(TODAY, -14),
      frequency: Frequency.WEEKLY,
      dayOfWeek: 5,
      daysOfWeek: [],
      assigneeId: fixture.memberId,
    });
    await generateInstances(prisma, TODAY, addDays(TODAY, 20));

    const ahead = await getComingUp(prisma, who(), TODAY);
    const weekly = ahead.filter((t) => t.title === "Weekly range check");
    // Two Fridays fall inside the fortnight. The second one says nothing the
    // first did not, and costs a row saying it.
    expect(weekly).toHaveLength(1);
    expect(weekly[0].dueDate).toBe(addDays(TODAY, 2));
  });

  it("orders it by the day it is due, nearest first", async () => {
    await scheduled("Later", 5, 14);
    await scheduled("Sooner", 1, 14);
    await scheduled("Middle", 3, 14);

    const ahead = await getComingUp(prisma, who(), TODAY);
    expect(ahead.map((t) => t.title)).toEqual(["Sooner", "Middle", "Later"]);
    expect(ahead.map((t) => toDateOnly(t.dueDate))).toEqual([
      addDays(TODAY, 1),
      addDays(TODAY, 3),
      addDays(TODAY, 5),
    ]);
  });
});
