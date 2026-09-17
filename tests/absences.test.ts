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
import { generateInstances, sweepMissed } from "@/lib/recurrence";
import { createAbsence, deleteAbsence } from "@/lib/absences";
import { buildPersonReport, buildWindow, totalsOf } from "@/lib/reports";
import { completeInstance } from "@/lib/instances";
import { addDays, londonTimeOn, todayInLondon } from "@/lib/time";

const available = await databaseAvailable();
const describeDb = available ? describe : describe.skip;

const TODAY = todayInLondon();
const NOON = londonTimeOn(TODAY, "12:00");

describeDb("time off", () => {
  let fixture: Fixture;
  const admin = () => ({ id: fixture.adminId, role: Role.ADMIN, organisationId: fixture.orgId });
  const member = () => ({ id: fixture.memberId, role: Role.MEMBER, organisationId: fixture.orgId });

  beforeEach(async () => {
    fixture = await seedFixture();
  });

  async function dailyTask() {
    return createTemplate(fixture, {
      title: "Clear the support inbox",
      startDate: addDays(TODAY, -10),
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
      assigneeId: fixture.memberId,
    });
  }

  it("only an admin can record it", async () => {
    await expect(
      createAbsence(prisma, member(), { userId: fixture.memberId, from: TODAY, to: TODAY }),
    ).rejects.toThrow(/only an admin/i);
  });

  it("refuses a range that ends before it starts", async () => {
    await expect(
      createAbsence(prisma, admin(), {
        userId: fixture.memberId,
        from: addDays(TODAY, 3),
        to: TODAY,
      }),
    ).rejects.toThrow(/cannot be before/i);
  });

  it("refuses someone covering their own time off", async () => {
    await expect(
      createAbsence(prisma, admin(), {
        userId: fixture.memberId,
        from: TODAY,
        to: TODAY,
        coverUserId: fixture.memberId,
      }),
    ).rejects.toThrow(/cover their own/i);
  });

  it("refuses an overlap with time off already recorded", async () => {
    await createAbsence(prisma, admin(), {
      userId: fixture.memberId,
      from: TODAY,
      to: addDays(TODAY, 5),
    });
    await expect(
      createAbsence(prisma, admin(), {
        userId: fixture.memberId,
        from: addDays(TODAY, 3),
        to: addDays(TODAY, 8),
      }),
    ).rejects.toThrow(/overlaps/i);
  });

  describe("with nobody covering", () => {
    it("excuses the days already generated", async () => {
      const template = await dailyTask();
      await generateInstances(prisma, TODAY, addDays(TODAY, 6));

      const { applied } = await createAbsence(prisma, admin(), {
        userId: fixture.memberId,
        from: addDays(TODAY, 1),
        to: addDays(TODAY, 3),
        reason: "Annual leave",
      });

      expect(applied.excused).toBe(3);
      const rows = await instancesFor(template.id);
      const excused = rows.filter((r) => r.status === InstanceStatus.EXCUSED);
      expect(excused).toHaveLength(3);
    });

    it("excuses days generated after the fact", async () => {
      const template = await dailyTask();
      await createAbsence(prisma, admin(), {
        userId: fixture.memberId,
        from: addDays(TODAY, 1),
        to: addDays(TODAY, 2),
      });
      // Generation runs a fortnight ahead, so most holiday days are created
      // after the absence is recorded.
      await generateInstances(prisma, TODAY, addDays(TODAY, 4));

      const rows = await instancesFor(template.id);
      const excused = rows.filter((r) => r.status === InstanceStatus.EXCUSED);
      expect(excused.map((r) => r.dueDate.toISOString().slice(0, 10)).sort()).toEqual([
        addDays(TODAY, 1),
        addDays(TODAY, 2),
      ]);
    });

    it("keeps excused days out of the completion rate entirely", async () => {
      await dailyTask();
      await generateInstances(prisma, addDays(TODAY, -4), TODAY);
      await createAbsence(prisma, admin(), {
        userId: fixture.memberId,
        from: addDays(TODAY, -2),
        to: TODAY,
      });

      const rows = await prisma.taskInstance.findMany({
        where: { assigneeId: fixture.memberId },
        select: { status: true, wasLate: true },
      });
      const totals = totalsOf(rows);

      // 5 days, 3 of them excused: only the other 2 are owed.
      expect(totals.excused).toBe(3);
      expect(totals.assigned).toBe(2);
    });

    it("does not let the sweep turn an excused day into a miss", async () => {
      const template = await dailyTask();
      await generateInstances(prisma, addDays(TODAY, -8), addDays(TODAY, -6));
      await createAbsence(prisma, admin(), {
        userId: fixture.memberId,
        from: addDays(TODAY, -8),
        to: addDays(TODAY, -6),
      });

      await sweepMissed(prisma, TODAY, 2);

      const rows = await instancesFor(template.id);
      expect(rows.every((r) => r.status === InstanceStatus.EXCUSED)).toBe(true);
    });

    it("leaves work already done, and misses already recorded, alone", async () => {
      const template = await dailyTask();
      await generateInstances(prisma, addDays(TODAY, -6), TODAY);
      const rows = await instancesFor(template.id);

      // Inside the grace window, or completing it is refused for that reason
      // rather than anything to do with time off.
      const done = rows.find((r) => r.dueDate.toISOString().startsWith(addDays(TODAY, -1)))!;
      await completeInstance(prisma, done.id, member(), { note: "Did it", now: NOON });
      await sweepMissed(prisma, TODAY, 2);

      await createAbsence(prisma, admin(), {
        userId: fixture.memberId,
        from: addDays(TODAY, -6),
        to: TODAY,
      });

      const after = await prisma.taskInstance.findUnique({ where: { id: done.id } });
      expect(after?.status).toBe(InstanceStatus.COMPLETED);
      // An existing miss must not be retroactively excused.
      const missed = await prisma.taskInstance.count({
        where: { templateId: template.id, status: InstanceStatus.MISSED },
      });
      expect(missed).toBeGreaterThan(0);
    });
  });

  describe("with a cover person", () => {
    it("moves the existing days to them", async () => {
      const template = await dailyTask();
      await generateInstances(prisma, TODAY, addDays(TODAY, 3));

      const { applied } = await createAbsence(prisma, admin(), {
        userId: fixture.memberId,
        from: TODAY,
        to: addDays(TODAY, 2),
        coverUserId: fixture.otherMemberId,
      });

      expect(applied.covered).toBe(3);
      const rows = await instancesFor(template.id);
      const theirs = rows.filter((r) => r.assigneeId === fixture.otherMemberId);
      expect(theirs).toHaveLength(3);
      expect(theirs.every((r) => r.status === InstanceStatus.PENDING)).toBe(true);
    });

    it("assigns days generated later straight to them", async () => {
      const template = await dailyTask();
      await createAbsence(prisma, admin(), {
        userId: fixture.memberId,
        from: addDays(TODAY, 1),
        to: addDays(TODAY, 2),
        coverUserId: fixture.otherMemberId,
      });
      await generateInstances(prisma, TODAY, addDays(TODAY, 3));

      const rows = await instancesFor(template.id);
      const covered = rows.filter((r) => r.assigneeId === fixture.otherMemberId);
      expect(covered).toHaveLength(2);
      expect(covered.every((r) => r.status === InstanceStatus.PENDING)).toBe(true);
    });

    it("counts covered work against the cover person, not the absentee", async () => {
      await dailyTask();
      await createAbsence(prisma, admin(), {
        userId: fixture.memberId,
        from: TODAY,
        to: TODAY,
        coverUserId: fixture.otherMemberId,
      });
      await generateInstances(prisma, TODAY, TODAY);

      const window = buildWindow({ from: TODAY, to: TODAY });
      const absentee = await buildPersonReport(prisma, fixture.orgId, fixture.memberId, window);
      const cover = await buildPersonReport(prisma, fixture.orgId, fixture.otherMemberId, window);

      expect(absentee?.totals.assigned).toBe(0);
      expect(cover?.totals.assigned).toBe(1);
    });
  });

  describe("covering some tasks but not others", () => {
    it("moves only the chosen ones and excuses the rest", async () => {
      const moving = await createTemplate(fixture, {
        title: "Pick and pack web orders",
        startDate: TODAY,
        daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
        assigneeId: fixture.memberId,
      });
      const staying = await createTemplate(fixture, {
        title: "Wipe down the fitting studio",
        startDate: TODAY,
        daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
        assigneeId: fixture.memberId,
      });
      await generateInstances(prisma, TODAY, addDays(TODAY, 1));

      const { applied } = await createAbsence(prisma, admin(), {
        userId: fixture.memberId,
        from: TODAY,
        to: addDays(TODAY, 1),
        covers: [{ templateId: moving.id, coverUserId: fixture.otherMemberId }],
      });

      expect(applied).toEqual({ covered: 2, excused: 2 });

      const covered = await instancesFor(moving.id);
      expect(covered.every((r) => r.assigneeId === fixture.otherMemberId)).toBe(true);
      expect(covered.every((r) => r.status === InstanceStatus.PENDING)).toBe(true);

      const excused = await instancesFor(staying.id);
      expect(excused.every((r) => r.assigneeId === fixture.memberId)).toBe(true);
      expect(excused.every((r) => r.status === InstanceStatus.EXCUSED)).toBe(true);
    });

    it("lets one task be excused while the rest are covered", async () => {
      const general = await createTemplate(fixture, {
        title: "Clear the support inbox",
        startDate: TODAY,
        daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
        assigneeId: fixture.memberId,
      });
      const dropped = await createTemplate(fixture, {
        title: "Post to Instagram",
        startDate: TODAY,
        daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
        assigneeId: fixture.memberId,
      });
      await generateInstances(prisma, TODAY, TODAY);

      // Default covers everything; this one task opts out.
      const { applied } = await createAbsence(prisma, admin(), {
        userId: fixture.memberId,
        from: TODAY,
        to: TODAY,
        coverUserId: fixture.otherMemberId,
        covers: [{ templateId: dropped.id, coverUserId: null }],
      });

      expect(applied).toEqual({ covered: 1, excused: 1 });
      expect((await instancesFor(general.id))[0].assigneeId).toBe(fixture.otherMemberId);
      expect((await instancesFor(dropped.id))[0].status).toBe(InstanceStatus.EXCUSED);
    });

    it("applies the same split to days generated afterwards", async () => {
      const moving = await createTemplate(fixture, {
        title: "Goods in",
        startDate: TODAY,
        daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
        assigneeId: fixture.memberId,
      });
      const staying = await createTemplate(fixture, {
        title: "Range balls",
        startDate: TODAY,
        daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
        assigneeId: fixture.memberId,
      });

      await createAbsence(prisma, admin(), {
        userId: fixture.memberId,
        from: addDays(TODAY, 1),
        to: addDays(TODAY, 2),
        covers: [{ templateId: moving.id, coverUserId: fixture.otherMemberId }],
      });
      // Generated after the fact, the way the nightly job does it.
      await generateInstances(prisma, TODAY, addDays(TODAY, 2));

      const covered = (await instancesFor(moving.id)).filter(
        (r) => r.assigneeId === fixture.otherMemberId,
      );
      expect(covered).toHaveLength(2);

      const excused = (await instancesFor(staying.id)).filter(
        (r) => r.status === InstanceStatus.EXCUSED,
      );
      expect(excused).toHaveLength(2);
    });

    it("refuses a per-task cover that is the absent person", async () => {
      const template = await createTemplate(fixture, {
        title: "Anything",
        startDate: TODAY,
        assigneeId: fixture.memberId,
      });
      await expect(
        createAbsence(prisma, admin(), {
          userId: fixture.memberId,
          from: TODAY,
          to: TODAY,
          covers: [{ templateId: template.id, coverUserId: fixture.memberId }],
        }),
      ).rejects.toThrow(/cover their own/i);
    });
  });

  it("puts outstanding work back when the time off is cancelled", async () => {
    const template = await dailyTask();
    await generateInstances(prisma, TODAY, addDays(TODAY, 2));
    const { absence } = await createAbsence(prisma, admin(), {
      userId: fixture.memberId,
      from: TODAY,
      to: addDays(TODAY, 2),
    });

    const { restored } = await deleteAbsence(prisma, admin(), absence.id);

    expect(restored).toBe(3);
    const rows = await instancesFor(template.id);
    expect(rows.every((r) => r.status === InstanceStatus.PENDING)).toBe(true);
  });
});
