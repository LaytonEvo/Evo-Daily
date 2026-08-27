import { InstanceStatus, Role } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { createTemplate, databaseAvailable, prisma, seedFixture, type Fixture } from "./helpers/db";
import { generateInstances, sweepMissed } from "@/lib/recurrence";
import { completeInstance, isOverdue, daysLate, isWithinGraceWindow } from "@/lib/instances";
import { ensureInstancesForToday, getMyDay } from "@/lib/my-day";
import { assertCronSecret } from "@/lib/cron-auth";
import { addDays } from "@/lib/time";

const available = await databaseAvailable();
const describeDb = available ? describe : describe.skip;

const TODAY = "2026-08-27"; // Thursday

describe("derived display state", () => {
  it("treats a past-due PENDING instance as Overdue, and nothing else", () => {
    expect(isOverdue({ status: InstanceStatus.PENDING, dueDate: "2026-08-26" }, TODAY)).toBe(true);
    expect(isOverdue({ status: InstanceStatus.PENDING, dueDate: TODAY }, TODAY)).toBe(false);
    expect(isOverdue({ status: InstanceStatus.COMPLETED, dueDate: "2026-08-20" }, TODAY)).toBe(false);
    expect(isOverdue({ status: InstanceStatus.MISSED, dueDate: "2026-08-20" }, TODAY)).toBe(false);
  });

  it("counts how many days late an overdue task is", () => {
    expect(daysLate("2026-08-26", TODAY)).toBe(1);
    expect(daysLate("2026-08-25", TODAY)).toBe(2);
    expect(daysLate(TODAY, TODAY)).toBe(0);
  });

  it("closes the grace window at exactly graceDays", () => {
    expect(isWithinGraceWindow(addDays(TODAY, -2), 2, TODAY)).toBe(true);
    expect(isWithinGraceWindow(addDays(TODAY, -3), 2, TODAY)).toBe(false);
  });
});

/** The status a thrown error carries, as errorResponse reads it. */
function statusOfThrown(fn: () => void): number | null {
  try {
    fn();
    return null;
  } catch (error) {
    const status = (error as Error & { status?: unknown }).status;
    return typeof status === "number" ? status : null;
  }
}

describe("cron guard", () => {
  const original = process.env.CRON_SECRET;

  it("rejects a request with no secret (acceptance test 21)", () => {
    process.env.CRON_SECRET = "correct-horse";
    expect(() => assertCronSecret(new Request("http://localhost/api/cron/generate"))).toThrow(
      /unauthorised/i,
    );
    // The status must survive to the route handler as a 401, not a 500.
    expect(statusOfThrown(() => assertCronSecret(new Request("http://localhost/x")))).toBe(401);
  });

  it("rejects a wrong secret", () => {
    process.env.CRON_SECRET = "correct-horse";
    const request = new Request("http://localhost/api/cron/generate", {
      headers: { "x-cron-secret": "battery-staple" },
    });
    expect(() => assertCronSecret(request)).toThrow(/unauthorised/i);
    expect(statusOfThrown(() => assertCronSecret(request))).toBe(401);
  });

  it("refuses to run at all when no secret is configured", () => {
    delete process.env.CRON_SECRET;
    const request = new Request("http://localhost/api/cron/generate", {
      headers: { "x-cron-secret": "anything" },
    });
    expect(() => assertCronSecret(request)).toThrow(/not configured/i);
    expect(statusOfThrown(() => assertCronSecret(request))).toBe(500);
  });

  it("accepts the right secret", () => {
    process.env.CRON_SECRET = "correct-horse";
    const request = new Request("http://localhost/api/cron/generate", {
      headers: { "x-cron-secret": "correct-horse" },
    });
    expect(() => assertCronSecret(request)).not.toThrow();
    process.env.CRON_SECRET = original;
  });
});

describeDb("/my-day sections", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await seedFixture({ graceDays: 2 });
  });

  const member = () => ({
    id: fixture.memberId,
    role: Role.MEMBER,
    organisationId: fixture.orgId,
  });

  it("puts yesterday's untouched task under Overdue, still tickable (acceptance test 12)", async () => {
    await createTemplate(fixture, {
      title: "Yesterday's job",
      startDate: addDays(TODAY, -1),
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    });
    await generateInstances(prisma, addDays(TODAY, -1), addDays(TODAY, -1));
    await sweepMissed(prisma, TODAY, 2);

    const day = await getMyDay(prisma, { id: fixture.memberId, organisationId: fixture.orgId }, TODAY);

    expect(day.overdue).toHaveLength(1);
    expect(day.overdue[0].title).toBe("Yesterday's job");
    expect(day.overdue[0].daysLate).toBe(1);
    expect(day.overdue[0].editable).toBe(true);
    expect(day.dueToday).toHaveLength(0);
  });

  it("hides a hardened MISSED task from the screen entirely", async () => {
    await createTemplate(fixture, {
      startDate: addDays(TODAY, -5),
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    });
    await generateInstances(prisma, addDays(TODAY, -5), addDays(TODAY, -5));
    await sweepMissed(prisma, TODAY, 2);

    const day = await getMyDay(prisma, { id: fixture.memberId, organisationId: fixture.orgId }, TODAY);
    expect(day.overdue).toHaveLength(0);
    expect(day.doneToday).toHaveLength(0);
  });

  it("splits today, this week and this month correctly", async () => {
    await createTemplate(fixture, {
      title: "Every day",
      startDate: TODAY,
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    });
    await createTemplate(fixture, {
      title: "Month end",
      frequency: "MONTHLY",
      dayOfMonth: 31,
      startDate: TODAY,
    });
    await generateInstances(prisma, TODAY, "2026-08-31");

    const day = await getMyDay(prisma, { id: fixture.memberId, organisationId: fixture.orgId }, TODAY);

    // Thu 27 Aug: this week runs to Sunday the 30th.
    expect(day.dueToday.map((t) => t.dueDate)).toEqual([TODAY]);
    expect(day.thisWeek.map((t) => t.dueDate)).toEqual(["2026-08-28", "2026-08-29", "2026-08-30"]);
    expect(day.thisMonth.map((t) => t.title).sort()).toEqual(["Every day", "Month end"]);
  });

  it("moves a completed task into Done today and updates the progress ring", async () => {
    await createTemplate(fixture, {
      startDate: TODAY,
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    });
    await generateInstances(prisma, TODAY, TODAY);

    const before = await getMyDay(prisma, { id: fixture.memberId, organisationId: fixture.orgId }, TODAY);
    expect(before.owedTotal).toBe(1);
    expect(before.owedDone).toBe(0);

    await completeInstance(prisma, before.dueToday[0].id, member());

    const after = await getMyDay(prisma, { id: fixture.memberId, organisationId: fixture.orgId }, TODAY);
    expect(after.dueToday).toHaveLength(0);
    expect(after.doneToday).toHaveLength(1);
    expect(after.owedDone).toBe(1);
    expect(after.owedTotal).toBe(1);
  });

  it("shows only the signed-in member's own tasks", async () => {
    await createTemplate(fixture, {
      title: "Mine",
      startDate: TODAY,
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
      assigneeId: fixture.memberId,
    });
    await createTemplate(fixture, {
      title: "Theirs",
      startDate: TODAY,
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
      assigneeId: fixture.otherMemberId,
    });
    await generateInstances(prisma, TODAY, TODAY);

    const day = await getMyDay(prisma, { id: fixture.memberId, organisationId: fixture.orgId }, TODAY);
    expect(day.dueToday.map((t) => t.title)).toEqual(["Mine"]);
  });

  it("only shows a cut-off time when one was actually set", async () => {
    await createTemplate(fixture, {
      title: "Timed",
      startDate: TODAY,
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
      dueTime: "10:00",
    });
    await createTemplate(fixture, {
      title: "Untimed",
      startDate: TODAY,
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    });
    await generateInstances(prisma, TODAY, TODAY);

    const day = await getMyDay(prisma, { id: fixture.memberId, organisationId: fixture.orgId }, TODAY);
    const timed = day.dueToday.find((t) => t.title === "Timed");
    const untimed = day.dueToday.find((t) => t.title === "Untimed");

    expect(timed?.dueTimeLabel).toBe("10:00");
    expect(untimed?.dueTimeLabel).toBeNull();
  });

  it("self-heals a missed cron run on page load", async () => {
    await createTemplate(fixture, {
      startDate: TODAY,
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    });
    // No generate job has run at all.
    expect(await prisma.taskInstance.count()).toBe(0);

    await ensureInstancesForToday(prisma, fixture.orgId, TODAY);
    expect(await prisma.taskInstance.count()).toBe(1);

    // And it is safe on every subsequent load.
    await ensureInstancesForToday(prisma, fixture.orgId, TODAY);
    await ensureInstancesForToday(prisma, fixture.orgId, TODAY);
    expect(await prisma.taskInstance.count()).toBe(1);
  });
});
