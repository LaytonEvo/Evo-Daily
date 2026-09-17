import { beforeEach, describe, expect, it } from "vitest";
import { InstanceStatus, Role } from "@prisma/client";
import {
  createTemplate,
  databaseAvailable,
  instancesFor,
  prisma,
  seedFixture,
  type Fixture,
} from "./helpers/db";
import { generateInstances } from "@/lib/recurrence";
import { completeInstance, markNotDone, TransitionError } from "@/lib/instances";
import { addDays, londonTimeOn, todayInLondon } from "@/lib/time";

const available = await databaseAvailable();
const describeDb = available ? describe : describe.skip;

// The wall clock decides the grace window, so these run against the real today.
const TODAY = todayInLondon();
const YESTERDAY = addDays(TODAY, -1);
const NOON = londonTimeOn(TODAY, "12:00");

describeDb("late completions and write-offs", () => {
  let fixture: Fixture;
  let dueToday: string;
  let dueYesterday: string;

  const member = (): { id: string; role: Role; organisationId: string } => ({
    id: fixture.memberId,
    role: Role.MEMBER,
    organisationId: fixture.orgId,
  });
  const admin = () => ({ id: fixture.adminId, role: Role.ADMIN, organisationId: fixture.orgId });

  beforeEach(async () => {
    fixture = await seedFixture();
    const today = await createTemplate(fixture, {
      title: "Today's task",
      startDate: TODAY,
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    });
    const yesterday = await createTemplate(fixture, {
      title: "Yesterday's task",
      startDate: YESTERDAY,
      endDate: YESTERDAY,
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    });
    await generateInstances(prisma, YESTERDAY, TODAY);
    dueToday = (await instancesFor(today.id)).find((i) => i.dueDate.toISOString().startsWith(TODAY))!.id;
    dueYesterday = (await instancesFor(yesterday.id))[0].id;
  });

  describe("a late completion must say why", () => {
    it("refuses to tick off an overdue task with no reason", async () => {
      await expect(
        completeInstance(prisma, dueYesterday, member(), { now: NOON }),
      ).rejects.toThrow(TransitionError);

      const after = await prisma.taskInstance.findUnique({ where: { id: dueYesterday } });
      expect(after?.status).toBe(InstanceStatus.PENDING);
    });

    it("refuses a reason that is only whitespace", async () => {
      await expect(
        completeInstance(prisma, dueYesterday, member(), { note: "   ", now: NOON }),
      ).rejects.toThrow(TransitionError);
    });

    it("accepts an overdue completion with a reason and keeps it", async () => {
      const done = await completeInstance(prisma, dueYesterday, member(), {
        note: "Supplier did not deliver until this morning",
        now: NOON,
      });

      expect(done.status).toBe(InstanceStatus.COMPLETED);
      expect(done.note).toBe("Supplier did not deliver until this morning");
    });

    it("still lets a task due today be ticked with no reason", async () => {
      // The rule is about lateness, not about adding friction to every tick.
      const done = await completeInstance(prisma, dueToday, member(), { now: NOON });
      expect(done.status).toBe(InstanceStatus.COMPLETED);
      expect(done.note).toBeNull();
    });

    it("accepts a reason already stored on the instance", async () => {
      await prisma.taskInstance.update({
        where: { id: dueYesterday },
        data: { note: "Explained at the time" },
      });
      const done = await completeInstance(prisma, dueYesterday, member(), { now: NOON });
      expect(done.status).toBe(InstanceStatus.COMPLETED);
    });
  });

  describe("an admin can write a task off", () => {
    it("moves it to MISSED with the reason, and out of the member's day", async () => {
      const off = await markNotDone(prisma, dueToday, admin(), "Shop shut for the bank holiday", {
        now: NOON,
      });

      expect(off.status).toBe(InstanceStatus.MISSED);
      expect(off.note).toBe("Shop shut for the bank holiday");
    });

    it("records who did it in the audit log", async () => {
      await markNotDone(prisma, dueToday, admin(), "Not happening", { now: NOON });

      const log = await prisma.auditLog.findFirst({ where: { instanceId: dueToday } });
      expect(log?.toStatus).toBe(InstanceStatus.MISSED);
      expect(log?.userId).toBe(fixture.adminId);
      expect(log?.source).toBe("USER");
    });

    it("clears a previous completion rather than leaving both recorded", async () => {
      await completeInstance(prisma, dueToday, member(), { now: NOON });
      const off = await markNotDone(prisma, dueToday, admin(), "Ticked in error", { now: NOON });

      expect(off.status).toBe(InstanceStatus.MISSED);
      expect(off.completedAt).toBeNull();
      expect(off.completedById).toBeNull();
      expect(off.wasLate).toBe(false);
    });

    it("refuses a member", async () => {
      await expect(
        markNotDone(prisma, dueToday, member(), "I do not fancy it", { now: NOON }),
      ).rejects.toThrow(TransitionError);

      const after = await prisma.taskInstance.findUnique({ where: { id: dueToday } });
      expect(after?.status).toBe(InstanceStatus.PENDING);
    });

    it("refuses an empty reason", async () => {
      await expect(
        markNotDone(prisma, dueToday, admin(), "  ", { now: NOON }),
      ).rejects.toThrow(TransitionError);
    });

    it("is idempotent", async () => {
      await markNotDone(prisma, dueToday, admin(), "First call", { now: NOON });
      const again = await markNotDone(prisma, dueToday, admin(), "Second call", { now: NOON });

      expect(again.note).toBe("First call");
      expect(await prisma.auditLog.count({ where: { instanceId: dueToday } })).toBe(1);
    });
  });
});
