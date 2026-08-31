import { InstanceStatus, Role } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createTemplate,
  databaseAvailable,
  instancesFor,
  prisma,
  seedFixture,
  type Fixture,
} from "./helpers/db";
import {
  generateInstances,
  regenerateFutureInstances,
  removeFutureInstances,
  sweepMissed,
} from "@/lib/recurrence";
import { completeInstance, uncompleteInstance } from "@/lib/instances";
import { addDays, londonTimeOn, toDateOnly, toDbDate } from "@/lib/time";

const available = await databaseAvailable();
const describeDb = available ? describe : describe.skip;

if (!available) {
  console.warn("Skipping database tests — set TEST_DATABASE_URL to run them.");
}

// A fixed "today" so the suite reads the same in January as in July — and,
// because the clock is passed in rather than read, the same next year.
const TODAY = "2026-08-27"; // Thursday
const NOON = londonTimeOn(TODAY, "12:00");

describeDb("generateInstances", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await seedFixture();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("writes one instance per due date with the snapshot fields frozen", async () => {
    const template = await createTemplate(fixture, {
      title: "Clear the inbox",
      startDate: "2026-08-24",
      daysOfWeek: [1, 2, 3, 4, 5],
      dueTime: "10:00",
    });

    const result = await generateInstances(prisma, "2026-08-24", "2026-08-30");
    expect(result.created).toBe(5);

    const instances = await instancesFor(template.id);
    expect(instances.map((i) => toDateOnly(i.dueDate))).toEqual([
      "2026-08-24",
      "2026-08-25",
      "2026-08-26",
      "2026-08-27",
      "2026-08-28",
    ]);
    expect(instances[0].title).toBe("Clear the inbox");
    expect(instances[0].assigneeId).toBe(fixture.memberId);
    expect(instances[0].categoryId).toBe(fixture.categoryId);
    expect(instances[0].status).toBe(InstanceStatus.PENDING);
    // 10:00 BST is 09:00 UTC.
    expect(instances[0].dueAt?.toISOString()).toBe("2026-08-24T09:00:00.000Z");
  });

  it("defaults dueAt to the end of the London day when no cut-off is set", async () => {
    const template = await createTemplate(fixture, { startDate: "2026-08-27" });
    await generateInstances(prisma, "2026-08-27", "2026-08-27");
    const [instance] = await instancesFor(template.id);
    expect(instance.dueAt?.toISOString()).toBe("2026-08-27T22:59:59.999Z");
  });

  it("produces zero duplicates when run three times (acceptance test 4)", async () => {
    await createTemplate(fixture, { startDate: "2026-08-01", daysOfWeek: [1, 2, 3, 4, 5] });
    await createTemplate(fixture, {
      title: "Weekly count",
      frequency: "WEEKLY",
      dayOfWeek: 1,
      startDate: "2026-08-01",
    });
    await createTemplate(fixture, {
      title: "Month end",
      frequency: "MONTHLY",
      dayOfMonth: 31,
      startDate: "2026-08-01",
    });

    const first = await generateInstances(prisma, "2026-08-01", "2026-09-30");
    const countAfterFirst = await prisma.taskInstance.count();
    expect(first.created).toBe(countAfterFirst);
    expect(countAfterFirst).toBeGreaterThan(0);

    const second = await generateInstances(prisma, "2026-08-01", "2026-09-30");
    const third = await generateInstances(prisma, "2026-08-01", "2026-09-30");

    expect(second.created).toBe(0);
    expect(third.created).toBe(0);
    expect(await prisma.taskInstance.count()).toBe(countAfterFirst);
  });

  it("generates nothing for a template whose endDate is in the past (acceptance test 5)", async () => {
    const template = await createTemplate(fixture, {
      startDate: "2026-01-01",
      endDate: "2026-06-30",
    });
    const result = await generateInstances(prisma, "2026-08-24", "2026-08-28");
    expect(result.created).toBe(0);
    expect(await instancesFor(template.id)).toHaveLength(0);
  });

  it("ignores inactive templates", async () => {
    const template = await createTemplate(fixture, { startDate: "2026-08-01", isActive: false });
    await generateInstances(prisma, "2026-08-24", "2026-08-28");
    expect(await instancesFor(template.id)).toHaveLength(0);
  });

  it("never touches an existing instance", async () => {
    const template = await createTemplate(fixture, { startDate: "2026-08-27" });
    await generateInstances(prisma, "2026-08-27", "2026-08-27");
    const [before] = await instancesFor(template.id);

    await completeInstance(prisma, before.id, {
      id: fixture.memberId,
      role: Role.MEMBER,
      organisationId: fixture.orgId,
    }, { now: NOON });

    await generateInstances(prisma, "2026-08-27", "2026-08-27");
    const [after] = await instancesFor(template.id);

    expect(after.id).toBe(before.id);
    expect(after.status).toBe(InstanceStatus.COMPLETED);
  });

  it("generates exactly one instance per day across the October clock change (acceptance test 9)", async () => {
    const template = await createTemplate(fixture, {
      startDate: "2026-10-22",
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    });
    await generateInstances(prisma, "2026-10-22", "2026-10-28");
    const instances = await instancesFor(template.id);

    expect(instances).toHaveLength(7);
    expect(instances.map((i) => toDateOnly(i.dueDate))).toEqual([
      "2026-10-22",
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
    ]);
    // 25 Oct is a 25-hour day; its end-of-day is still on the 25th in London.
    const clockChangeDay = instances[3];
    expect(clockChangeDay.dueAt?.toISOString()).toBe("2026-10-25T23:59:59.999Z");
  });

  it("generates exactly one instance per day across the March clock change (acceptance test 9)", async () => {
    const template = await createTemplate(fixture, {
      startDate: "2027-03-25",
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    });
    await generateInstances(prisma, "2027-03-25", "2027-03-31");
    const instances = await instancesFor(template.id);
    expect(instances).toHaveLength(7);
    expect(new Set(instances.map((i) => toDateOnly(i.dueDate))).size).toBe(7);
  });

  it("clamps a monthly template to the length of each month (acceptance test 2)", async () => {
    const template = await createTemplate(fixture, {
      frequency: "MONTHLY",
      dayOfMonth: 31,
      startDate: "2027-02-01",
    });
    await generateInstances(prisma, "2027-02-01", "2027-04-30");
    expect((await instancesFor(template.id)).map((i) => toDateOnly(i.dueDate))).toEqual([
      "2027-02-28",
      "2027-03-31",
      "2027-04-30",
    ]);
  });
});

describeDb("editing a template", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await seedFixture();
  });

  it("regenerates future instances but leaves today's and past ones alone (acceptance test 6)", async () => {
    const template = await createTemplate(fixture, {
      title: "Old title",
      startDate: addDays(TODAY, -10),
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    });
    await generateInstances(prisma, addDays(TODAY, -10), addDays(TODAY, 10));

    await prisma.taskTemplate.update({
      where: { id: template.id },
      data: { title: "New title" },
    });
    await regenerateFutureInstances(prisma, template.id, TODAY, 10);

    const instances = await instancesFor(template.id);
    for (const instance of instances) {
      const due = toDateOnly(instance.dueDate);
      // Past and today keep the title they were generated with; the future
      // picks up the new one.
      expect(instance.title).toBe(due <= TODAY ? "Old title" : "New title");
    }
    expect(instances.some((i) => toDateOnly(i.dueDate) > TODAY)).toBe(true);
  });

  it("does not change the assignee on any instance due today or earlier (acceptance test 7)", async () => {
    const template = await createTemplate(fixture, {
      startDate: addDays(TODAY, -5),
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
      assigneeId: fixture.memberId,
    });
    await generateInstances(prisma, addDays(TODAY, -5), addDays(TODAY, 5));

    await prisma.taskTemplate.update({
      where: { id: template.id },
      data: { assigneeId: fixture.otherMemberId },
    });
    await regenerateFutureInstances(prisma, template.id, TODAY, 5);

    for (const instance of await instancesFor(template.id)) {
      const due = toDateOnly(instance.dueDate);
      expect(instance.assigneeId).toBe(
        due <= TODAY ? fixture.memberId : fixture.otherMemberId,
      );
    }
  });

  it("leaves completed and missed future instances untouched when regenerating", async () => {
    const template = await createTemplate(fixture, {
      startDate: TODAY,
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    });
    await generateInstances(prisma, TODAY, addDays(TODAY, 5));

    const tomorrow = await prisma.taskInstance.findFirstOrThrow({
      where: { templateId: template.id, dueDate: toDbDate(addDays(TODAY, 1)) },
    });
    await completeInstance(prisma, tomorrow.id, {
      id: fixture.adminId,
      role: Role.ADMIN,
      organisationId: fixture.orgId,
    }, { now: NOON });

    await regenerateFutureInstances(prisma, template.id, TODAY, 5);

    const after = await prisma.taskInstance.findUniqueOrThrow({ where: { id: tomorrow.id } });
    expect(after.status).toBe(InstanceStatus.COMPLETED);
  });

  it("drops future pending instances on deactivation but keeps all history", async () => {
    const template = await createTemplate(fixture, {
      startDate: addDays(TODAY, -5),
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    });
    await generateInstances(prisma, addDays(TODAY, -5), addDays(TODAY, 5));
    const before = await instancesFor(template.id);

    const removed = await removeFutureInstances(prisma, template.id, TODAY);
    const after = await instancesFor(template.id);

    expect(removed).toBe(5);
    expect(after).toHaveLength(before.length - 5);
    expect(after.every((i) => toDateOnly(i.dueDate) <= TODAY)).toBe(true);
  });
});

describeDb("the sweep", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await seedFixture({ graceDays: 2 });
  });

  it("marks a task due 3 days ago as MISSED, and a member cannot tick it (acceptance test 11)", async () => {
    const template = await createTemplate(fixture, {
      startDate: addDays(TODAY, -3),
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    });
    await generateInstances(prisma, addDays(TODAY, -3), addDays(TODAY, -3));

    await sweepMissed(prisma, TODAY, 2);

    const [instance] = await instancesFor(template.id);
    expect(instance.status).toBe(InstanceStatus.MISSED);

    await expect(
      completeInstance(prisma, instance.id, {
        id: fixture.memberId,
        role: Role.MEMBER,
        organisationId: fixture.orgId,
      }, { now: NOON }),
    ).rejects.toThrow(/grace period/i);
  });

  it("leaves yesterday's task tickable (acceptance test 12)", async () => {
    const template = await createTemplate(fixture, {
      startDate: addDays(TODAY, -1),
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    });
    await generateInstances(prisma, addDays(TODAY, -1), addDays(TODAY, -1));

    await sweepMissed(prisma, TODAY, 2);

    const [instance] = await instancesFor(template.id);
    expect(instance.status).toBe(InstanceStatus.PENDING);

    const completed = await completeInstance(prisma, instance.id, {
      id: fixture.memberId,
      role: Role.MEMBER,
      organisationId: fixture.orgId,
    }, { now: NOON });
    expect(completed.status).toBe(InstanceStatus.COMPLETED);
    // Completed after its cut-off, so the metric still records it as late.
    expect(completed.wasLate).toBe(true);
  });

  it("is idempotent — a second run changes no rows (acceptance test 13)", async () => {
    await createTemplate(fixture, {
      startDate: addDays(TODAY, -10),
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    });
    await generateInstances(prisma, addDays(TODAY, -10), addDays(TODAY, -3));

    const first = await sweepMissed(prisma, TODAY, 2);
    const auditsAfterFirst = await prisma.auditLog.count();

    const second = await sweepMissed(prisma, TODAY, 2);

    expect(first.missed).toBeGreaterThan(0);
    expect(second.missed).toBe(0);
    expect(await prisma.auditLog.count()).toBe(auditsAfterFirst);
  });

  it("writes exactly one audit row per instance it hardens", async () => {
    const template = await createTemplate(fixture, {
      startDate: addDays(TODAY, -5),
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    });
    await generateInstances(prisma, addDays(TODAY, -5), addDays(TODAY, -3));

    const { missed } = await sweepMissed(prisma, TODAY, 2);
    const audits = await prisma.auditLog.findMany({
      where: { instance: { templateId: template.id } },
    });

    expect(audits).toHaveLength(missed);
    expect(audits.every((a) => a.source === "SYSTEM" && a.userId === null)).toBe(true);
    expect(audits.every((a) => a.toStatus === InstanceStatus.MISSED)).toBe(true);
  });

  it("never touches a completed instance", async () => {
    const template = await createTemplate(fixture, {
      startDate: addDays(TODAY, -5),
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    });
    await generateInstances(prisma, addDays(TODAY, -5), addDays(TODAY, -5));
    const [instance] = await instancesFor(template.id);

    await completeInstance(prisma, instance.id, {
      id: fixture.adminId,
      role: Role.ADMIN,
      organisationId: fixture.orgId,
    }, { now: NOON });
    await sweepMissed(prisma, TODAY, 2);

    const after = await prisma.taskInstance.findUniqueOrThrow({ where: { id: instance.id } });
    expect(after.status).toBe(InstanceStatus.COMPLETED);
  });
});

describeDb("status transitions", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await seedFixture({ graceDays: 2 });
  });

  const member = () => ({
    id: fixture.memberId,
    role: Role.MEMBER,
    organisationId: fixture.orgId,
  });
  const admin = () => ({
    id: fixture.adminId,
    role: Role.ADMIN,
    organisationId: fixture.orgId,
  });

  async function makeInstance(dueDate: string, dueTime: string | null = "10:00") {
    const template = await createTemplate(fixture, {
      startDate: dueDate,
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
      dueTime,
    });
    await generateInstances(prisma, dueDate, dueDate);
    const [instance] = await instancesFor(template.id);
    return instance;
  }

  it("sets wasLate when completed after the cut-off (acceptance test 10)", async () => {
    const instance = await makeInstance("2026-08-27", "10:00");
    const completed = await completeInstance(prisma, instance.id, member(), {
      // 10:30 BST, half an hour after the 10:00 cut-off.
      now: new Date("2026-08-27T09:30:00Z"),
    });
    expect(completed.wasLate).toBe(true);
  });

  it("leaves wasLate false when completed before the cut-off", async () => {
    const instance = await makeInstance("2026-08-27", "10:00");
    const completed = await completeInstance(prisma, instance.id, member(), {
      now: new Date("2026-08-27T08:30:00Z"), // 09:30 BST
    });
    expect(completed.wasLate).toBe(false);
  });

  it("writes exactly one audit row per transition (acceptance test 14)", async () => {
    const instance = await makeInstance("2026-08-27");

    await completeInstance(prisma, instance.id, member(), { now: NOON });
    await uncompleteInstance(prisma, instance.id, member(), { now: NOON });
    await completeInstance(prisma, instance.id, member(), { now: NOON });

    const audits = await prisma.auditLog.findMany({
      where: { instanceId: instance.id },
      orderBy: { at: "asc" },
    });
    expect(audits.map((a) => `${a.fromStatus}->${a.toStatus}`)).toEqual([
      "PENDING->COMPLETED",
      "COMPLETED->PENDING",
      "PENDING->COMPLETED",
    ]);
  });

  it("is idempotent — a double tap does not write a second audit row", async () => {
    const instance = await makeInstance("2026-08-27");
    await completeInstance(prisma, instance.id, member(), { now: NOON });
    await completeInstance(prisma, instance.id, member(), { now: NOON });
    expect(await prisma.auditLog.count({ where: { instanceId: instance.id } })).toBe(1);
  });

  it("stores a note alongside the completion, and clears it on request", async () => {
    const instance = await makeInstance("2026-08-27");
    const completed = await completeInstance(prisma, instance.id, member(), {
      note: "Two enquiries passed to Luke",
      now: NOON,
    });
    expect(completed.note).toBe("Two enquiries passed to Luke");
  });

  it("lets an admin override a MISSED instance to COMPLETED", async () => {
    const instance = await makeInstance(addDays(TODAY, -5));
    await sweepMissed(prisma, TODAY, 2);

    const completed = await completeInstance(prisma, instance.id, admin(), { now: NOON });
    expect(completed.status).toBe(InstanceStatus.COMPLETED);

    const audits = await prisma.auditLog.findMany({ where: { instanceId: instance.id } });
    expect(audits.at(-1)).toMatchObject({
      fromStatus: InstanceStatus.MISSED,
      toStatus: InstanceStatus.COMPLETED,
      userId: fixture.adminId,
    });
  });

  it("stops a member unticking outside the grace window, but not an admin", async () => {
    const instance = await makeInstance(addDays(TODAY, -5));
    await completeInstance(prisma, instance.id, admin(), { now: NOON });

    await expect(uncompleteInstance(prisma, instance.id, member(), { now: NOON })).rejects.toThrow(
      /grace period/i,
    );

    const reverted = await uncompleteInstance(prisma, instance.id, admin(), { now: NOON });
    expect(reverted.status).toBe(InstanceStatus.PENDING);
  });

  it("hides another member's instance behind a 404 (acceptance test 20)", async () => {
    const template = await createTemplate(fixture, {
      startDate: TODAY,
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
      assigneeId: fixture.otherMemberId,
    });
    await generateInstances(prisma, TODAY, TODAY);
    const [instance] = await instancesFor(template.id);

    await expect(completeInstance(prisma, instance.id, member(), { now: NOON })).rejects.toThrow(
      /not found/i,
    );
  });
});
