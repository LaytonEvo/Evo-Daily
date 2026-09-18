/**
 * What an edit does to the day already in progress, and what a star does to it.
 *
 * These pull in opposite directions and the line between them is the whole
 * point: an instance freezes its wording so a report reads correctly months
 * later, but freezing it on work nobody has started yet just leaves the wrong
 * thing on somebody's screen all day.
 */

import { InstanceStatus } from "@prisma/client";
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
import { updateTemplate } from "@/lib/templates";
import { getMyDay } from "@/lib/my-day";
import { addDays, formatTimeLondon, toDateOnly } from "@/lib/time";

const available = await databaseAvailable();
const describeDb = available ? describe : describe.skip;

const TODAY = "2026-08-27"; // Thursday

describeDb("editing a task reaches today", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await seedFixture();
  });

  const input = (over: Record<string, unknown> = {}) => ({
    title: "Record range ball stock level",
    assigneeId: fixture.memberId,
    frequency: "DAILY" as const,
    daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    startDate: addDays(TODAY, -30),
    isActive: true,
    isStarred: false,
    ...over,
  });

  async function seeded(over: Record<string, unknown> = {}) {
    const template = await createTemplate(fixture, {
      ...input(over),
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    });
    await generateInstances(prisma, addDays(TODAY, -3), addDays(TODAY, 14));
    return template;
  }

  const todayRow = async (templateId: string) =>
    (await instancesFor(templateId)).find((i) => toDateOnly(i.dueDate) === TODAY)!;

  it("retitles the instance due today while it is still open", async () => {
    const template = await seeded();
    expect((await todayRow(template.id)).title).toBe("Record range ball stock level");

    await updateTemplate(
      prisma,
      fixture.orgId,
      template.id,
      input({ title: "Record range ball stock and reorder under 40%" }),
      TODAY,
    );

    expect((await todayRow(template.id)).title).toBe(
      "Record range ball stock and reorder under 40%",
    );
  });

  it("moves today's cut-off time too", async () => {
    const template = await seeded({ dueTime: "09:00" });
    expect(formatTimeLondon((await todayRow(template.id)).dueAt!)).toBe("09:00");

    await updateTemplate(prisma, fixture.orgId, template.id, input({ dueTime: "16:30" }), TODAY);

    expect(formatTimeLondon((await todayRow(template.id)).dueAt!)).toBe("16:30");
  });

  it("changes today's category", async () => {
    const template = await seeded();
    const other = await prisma.category.create({
      data: { organisationId: fixture.orgId, name: "Stock", colour: "#ff0000" },
    });

    await updateTemplate(prisma, fixture.orgId, template.id, input({ categoryId: other.id }), TODAY);

    expect((await todayRow(template.id)).categoryId).toBe(other.id);
  });

  it("leaves a task already completed today exactly as it was", async () => {
    const template = await seeded();
    const before = await todayRow(template.id);
    await prisma.taskInstance.update({
      where: { id: before.id },
      data: { status: InstanceStatus.COMPLETED, completedAt: new Date() },
    });

    await updateTemplate(prisma, fixture.orgId, template.id, input({ title: "Renamed" }), TODAY);

    // Somebody did this, under this wording. That is the record.
    const after = await todayRow(template.id);
    expect(after.title).toBe("Record range ball stock level");
    expect(after.status).toBe(InstanceStatus.COMPLETED);
  });

  it("leaves yesterday alone even though it is still open", async () => {
    const template = await seeded();
    await updateTemplate(prisma, fixture.orgId, template.id, input({ title: "Renamed" }), TODAY);

    const yesterday = (await instancesFor(template.id)).find(
      (i) => toDateOnly(i.dueDate) === addDays(TODAY, -1),
    )!;
    expect(yesterday.title).toBe("Record range ball stock level");
  });
});

describeDb("starred tasks", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await seedFixture();
  });

  async function three() {
    // Deliberately ordered so the star has to beat both the clock and the
    // alphabet to reach the top.
    await createTemplate(fixture, {
      title: "A — earliest cut-off",
      startDate: TODAY,
      dueTime: "08:00",
      assigneeId: fixture.memberId,
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    });
    const starred = await createTemplate(fixture, {
      title: "Z — no cut-off at all",
      startDate: TODAY,
      assigneeId: fixture.memberId,
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    });
    await createTemplate(fixture, {
      title: "M — middle",
      startDate: TODAY,
      dueTime: "12:00",
      assigneeId: fixture.memberId,
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    });
    await generateInstances(prisma, TODAY, TODAY);
    return starred;
  }

  it("puts a starred task above everything else due that day", async () => {
    const starred = await three();
    const before = await getMyDay(
      prisma,
      { id: fixture.memberId, organisationId: fixture.orgId },
      TODAY,
    );
    expect(before.dueToday[0].title).toBe("A — earliest cut-off");

    await prisma.taskTemplate.update({ where: { id: starred.id }, data: { isStarred: true } });

    const after = await getMyDay(
      prisma,
      { id: fixture.memberId, organisationId: fixture.orgId },
      TODAY,
    );
    expect(after.dueToday[0].title).toBe("Z — no cut-off at all");
    expect(after.dueToday[0].starred).toBe(true);
    // Everything else keeps the order it had.
    expect(after.dueToday.slice(1).map((t) => t.title)).toEqual([
      "A — earliest cut-off",
      "M — middle",
    ]);
  });

  it("takes effect on the day it is starred, without regenerating anything", async () => {
    const starred = await three();
    const instancesBefore = await instancesFor(starred.id);

    await prisma.taskTemplate.update({ where: { id: starred.id }, data: { isStarred: true } });

    const day = await getMyDay(
      prisma,
      { id: fixture.memberId, organisationId: fixture.orgId },
      TODAY,
    );
    expect(day.dueToday[0].starred).toBe(true);
    // The star is read from the template, so no instance was touched.
    expect((await instancesFor(starred.id)).map((i) => i.id)).toEqual(
      instancesBefore.map((i) => i.id),
    );
  });

  it("sorts the overdue list the same way", async () => {
    await createTemplate(fixture, {
      title: "Ordinary",
      startDate: addDays(TODAY, -1),
      endDate: addDays(TODAY, -1),
      frequency: "ONE_OFF",
      assigneeId: fixture.memberId,
    });
    const starred = await createTemplate(fixture, {
      title: "Starred and late",
      startDate: addDays(TODAY, -1),
      endDate: addDays(TODAY, -1),
      frequency: "ONE_OFF",
      assigneeId: fixture.memberId,
    });
    await generateInstances(prisma, addDays(TODAY, -1), addDays(TODAY, -1));
    await prisma.taskTemplate.update({ where: { id: starred.id }, data: { isStarred: true } });

    const day = await getMyDay(
      prisma,
      { id: fixture.memberId, organisationId: fixture.orgId },
      TODAY,
    );
    expect(day.overdue[0].title).toBe("Starred and late");
  });
});
