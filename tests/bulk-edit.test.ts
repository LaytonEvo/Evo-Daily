/**
 * Editing many tasks at once.
 *
 * The risk a single edit does not have: one bad submission reaching every task
 * in the list, and the schedule is what generates tomorrow's work. So the two
 * things tested hardest are that a change touches only the fields it named,
 * and that an invalid change writes nothing at all rather than half of it.
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
import { updateTemplates } from "@/lib/templates";
import { generateInstances } from "@/lib/recurrence";
import { toDateOnly } from "@/lib/time";

const available = await databaseAvailable();
const describeDb = available ? describe : describe.skip;

const TODAY = "2026-08-27"; // Thursday

describeDb("bulk editing tasks", () => {
  let fixture: Fixture;
  let ids: string[];

  beforeEach(async () => {
    fixture = await seedFixture();

    const a = await createTemplate(fixture, {
      title: "Record range ball stock level",
      startDate: "2026-08-01",
      frequency: Frequency.DAILY,
      assigneeId: fixture.memberId,
      dueTime: "09:00",
    });
    const b = await createTemplate(fixture, {
      title: "Pick and pack web orders",
      startDate: "2026-08-10",
      frequency: Frequency.DAILY,
      assigneeId: fixture.memberId,
    });
    ids = [a.id, b.id];
  });

  async function reload(id: string) {
    return prisma.taskTemplate.findUniqueOrThrow({ where: { id } });
  }

  it("changes only the field it was given", async () => {
    const before = await reload(ids[0]);

    const result = await updateTemplates(
      prisma,
      fixture.orgId,
      ids,
      { startDate: "2026-09-01" },
      TODAY,
    );

    expect(result.updated).toBe(2);
    for (const id of ids) {
      const after = await reload(id);
      expect(toDateOnly(after.startDate)).toBe("2026-09-01");
    }

    // Everything else on the first task is exactly as it was. This is the
    // assertion that catches a merge that quietly blanks a field.
    const after = await reload(ids[0]);
    expect(after.title).toBe(before.title);
    expect(after.dueTime).toBe("09:00");
    expect(after.assigneeId).toBe(before.assigneeId);
    expect(after.categoryId).toBe(before.categoryId);
    expect(after.frequency).toBe(before.frequency);
    expect(after.daysOfWeek).toEqual(before.daysOfWeek);
  });

  it("moves a set of tasks to weekly, and sets the day they run", async () => {
    await updateTemplates(
      prisma,
      fixture.orgId,
      ids,
      { frequency: Frequency.WEEKLY, dayOfWeek: 2 },
      TODAY,
    );

    for (const id of ids) {
      const after = await reload(id);
      expect(after.frequency).toBe(Frequency.WEEKLY);
      expect(after.dayOfWeek).toBe(2);
      // The daily schedule is cleared, not left behind to confuse generation.
      expect(after.daysOfWeek).toEqual([]);
    }
  });

  it("refuses a move to weekly with no day, without writing anything", async () => {
    await expect(
      updateTemplates(prisma, fixture.orgId, ids, { frequency: Frequency.WEEKLY }, TODAY),
    ).rejects.toThrow(/day of the week/i);

    for (const id of ids) {
      expect((await reload(id)).frequency).toBe(Frequency.DAILY);
    }
  });

  it("refuses the whole batch when one task would end before it starts", async () => {
    // Only the second task starts after this end date, so a per-task failure
    // must still stop the first task being written.
    await updateTemplates(prisma, fixture.orgId, ids, { startDate: "2026-08-01" }, TODAY);
    await prisma.taskTemplate.update({
      where: { id: ids[1] },
      data: { startDate: new Date("2026-09-20") },
    });

    await expect(
      updateTemplates(prisma, fixture.orgId, ids, { endDate: "2026-09-10" }, TODAY),
    ).rejects.toThrow(/Pick and pack web orders/);

    expect((await reload(ids[0])).endDate).toBeNull();
  });

  it("clears a due time when told to, and leaves it alone when not", async () => {
    await updateTemplates(prisma, fixture.orgId, ids, { dueTime: null }, TODAY);
    expect((await reload(ids[0])).dueTime).toBeNull();

    await updateTemplates(prisma, fixture.orgId, ids, { dueTime: "16:30" }, TODAY);
    expect((await reload(ids[0])).dueTime).toBe("16:30");

    await updateTemplates(prisma, fixture.orgId, ids, { startDate: "2026-08-02" }, TODAY);
    expect((await reload(ids[0])).dueTime).toBe("16:30");
  });

  it("rebuilds future instances and leaves today and history alone", async () => {
    await generateInstances(prisma, "2026-08-20", "2026-09-10");
    const before = await instancesFor(ids[0]);
    const todayRow = before.find((i) => toDateOnly(i.dueDate) === TODAY);
    expect(todayRow).toBeDefined();

    await prisma.taskInstance.update({
      where: { id: todayRow!.id },
      data: { status: InstanceStatus.COMPLETED, completedAt: new Date() },
    });

    await updateTemplates(prisma, fixture.orgId, ids, { dueTime: "17:45" }, TODAY);

    const after = await instancesFor(ids[0]);
    const stillToday = after.find((i) => toDateOnly(i.dueDate) === TODAY);
    expect(stillToday?.status).toBe(InstanceStatus.COMPLETED);

    const future = after.filter((i) => toDateOnly(i.dueDate) > TODAY);
    expect(future.length).toBeGreaterThan(0);
  });

  it("will not touch a task in another organisation", async () => {
    const otherOrg = await prisma.organisation.create({
      data: { name: "Somebody Else Ltd", timezone: "Europe/London" },
    });
    const stranger = await prisma.taskTemplate.create({
      data: {
        organisationId: otherOrg.id,
        title: "Not yours",
        frequency: Frequency.DAILY,
        daysOfWeek: [1, 2, 3, 4, 5],
        startDate: new Date("2026-08-01"),
        assigneeId: fixture.adminId,
        createdById: fixture.adminId,
      },
    });

    const result = await updateTemplates(
      prisma,
      fixture.orgId,
      [...ids, stranger.id],
      { startDate: "2026-09-01" },
      TODAY,
    );

    expect(result.updated).toBe(2);
    expect(toDateOnly((await reload(stranger.id)).startDate)).toBe("2026-08-01");
  });

  it("reassigns and deactivates in the same edit", async () => {
    await updateTemplates(
      prisma,
      fixture.orgId,
      ids,
      { assigneeId: fixture.otherMemberId, isActive: false },
      TODAY,
    );

    for (const id of ids) {
      const after = await reload(id);
      expect(after.assigneeId).toBe(fixture.otherMemberId);
      expect(after.isActive).toBe(false);
    }
    // Deactivating drops unstarted future work.
    const future = (await instancesFor(ids[0])).filter(
      (i) => toDateOnly(i.dueDate) > TODAY,
    );
    expect(future).toHaveLength(0);
  });
});
