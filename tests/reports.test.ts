import { InstanceStatus, Role } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createTemplate,
  databaseAvailable,
  instancesFor,
  prisma,
  seedFixture,
  type Fixture,
} from "./helpers/db";
import { generateInstances, regenerateFutureInstances, sweepMissed } from "@/lib/recurrence";
import { completeInstance } from "@/lib/instances";
import {
  buildOrgReport,
  buildPersonReport,
  buildWindow,
  previousWindow,
  totalsOf,
  LOW_VOLUME_THRESHOLD,
  PROBLEM_TASK_MIN_INSTANCES,
} from "@/lib/reports";
import { toCsv } from "@/lib/csv";
import { addDays, toDateOnly, toDbDate } from "@/lib/time";

const available = await databaseAvailable();
const describeDb = available ? describe : describe.skip;

const TODAY = "2026-08-27";

describe("buildWindow", () => {
  it("defaults to a rolling 30 days ending today", () => {
    const window = buildWindow({}, TODAY);
    expect(window.from).toBe("2026-07-29");
    expect(window.to).toBe(TODAY);
    expect(window.days).toBe(30);
  });

  it("supports the 7 and 90 day presets", () => {
    expect(buildWindow({ days: 7 }, TODAY).from).toBe("2026-08-21");
    expect(buildWindow({ days: 90 }, TODAY).from).toBe("2026-05-30");
  });

  it("clips a custom range to today, so future work is never counted (acceptance test 15)", () => {
    const window = buildWindow({ from: "2026-08-01", to: "2026-12-31" }, TODAY);
    expect(window.to).toBe(TODAY);
    expect(window.requestedTo).toBe("2026-12-31");
  });

  it("puts the previous window immediately before, at the same length", () => {
    const window = buildWindow({ days: 30 }, TODAY);
    const previous = previousWindow(window);
    expect(previous.to).toBe(addDays(window.from, -1));
    expect(previous.days).toBe(window.days);
  });
});

describe("totalsOf", () => {
  it("implements the metric definitions exactly", () => {
    const totals = totalsOf([
      { status: InstanceStatus.COMPLETED, wasLate: false },
      { status: InstanceStatus.COMPLETED, wasLate: false },
      { status: InstanceStatus.COMPLETED, wasLate: true },
      { status: InstanceStatus.MISSED, wasLate: false },
      { status: InstanceStatus.PENDING, wasLate: false },
    ]);

    expect(totals).toMatchObject({
      assigned: 5,
      completed: 3,
      missed: 1,
      outstanding: 1,
      onTime: 2,
    });
    expect(totals.completionRate).toBeCloseTo(3 / 5);
    expect(totals.onTimeRate).toBeCloseTo(2 / 3);
  });

  it("returns a null on-time rate when nothing was completed", () => {
    const totals = totalsOf([{ status: InstanceStatus.MISSED, wasLate: false }]);
    expect(totals.onTimeRate).toBeNull();
    expect(totals.completionRate).toBe(0);
  });

  it("returns a null completion rate when nothing was assigned", () => {
    expect(totalsOf([]).completionRate).toBeNull();
  });
});

describeDb("org report", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await seedFixture();
  });

  const admin = () => ({
    id: fixture.adminId,
    role: Role.ADMIN,
    organisationId: fixture.orgId,
  });

  async function buildHistory() {
    const template = await createTemplate(fixture, {
      title: "Daily check",
      startDate: addDays(TODAY, -20),
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
      assigneeId: fixture.memberId,
    });
    // Generate history and a fortnight of future work.
    await generateInstances(prisma, addDays(TODAY, -20), addDays(TODAY, 14));
    return template;
  }

  it("excludes future instances from every denominator (acceptance test 15)", async () => {
    const template = await buildHistory();
    const all = await instancesFor(template.id);
    const future = all.filter((i) => toDateOnly(i.dueDate) > TODAY);
    expect(future.length).toBeGreaterThan(0);

    const window = buildWindow({ days: 30 }, TODAY);
    const report = await buildOrgReport(prisma, fixture.orgId, window);

    // 21 days of history: 20 back plus today.
    expect(report.totals.assigned).toBe(21);
    expect(report.leaderboard[0].assigned).toBe(21);
    expect(report.trend.every((point) => point.date <= TODAY)).toBe(true);
    expect(report.categories[0].assigned).toBe(21);
    expect(report.problemTasks[0].assigned).toBe(21);
    expect(report.problemTasks[0].assigned).toBeLessThan(all.length);
  });

  it("keeps the leaderboard consistent with the org summary (acceptance test 16)", async () => {
    await buildHistory();
    await createTemplate(fixture, {
      title: "Other person's task",
      startDate: addDays(TODAY, -20),
      daysOfWeek: [1, 3, 5],
      assigneeId: fixture.otherMemberId,
    });
    await generateInstances(prisma, addDays(TODAY, -20), TODAY);

    // Complete a scattering, then harden the rest.
    const pending = await prisma.taskInstance.findMany({
      where: { status: InstanceStatus.PENDING },
      orderBy: { dueDate: "asc" },
    });
    for (const [index, instance] of pending.entries()) {
      if (index % 3 !== 0) await completeInstance(prisma, instance.id, admin());
    }
    await sweepMissed(prisma, TODAY, 2);

    const report = await buildOrgReport(prisma, fixture.orgId, buildWindow({ days: 30 }, TODAY));

    const sum = (key: "assigned" | "completed" | "missed" | "outstanding" | "onTime") =>
      report.leaderboard.reduce((total, row) => total + row[key], 0);

    expect(sum("assigned")).toBe(report.totals.assigned);
    expect(sum("completed")).toBe(report.totals.completed);
    expect(sum("missed")).toBe(report.totals.missed);
    expect(sum("outstanding")).toBe(report.totals.outstanding);
    expect(sum("onTime")).toBe(report.totals.onTime);

    // And the categories partition the same set.
    expect(report.categories.reduce((t, r) => t + r.assigned, 0)).toBe(report.totals.assigned);
  });

  it("splits history correctly across both people when a template is reassigned mid-window (acceptance test 17)", async () => {
    const template = await createTemplate(fixture, {
      title: "Handover task",
      startDate: addDays(TODAY, -10),
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
      assigneeId: fixture.memberId,
    });
    await generateInstances(prisma, addDays(TODAY, -10), TODAY);

    const beforeCount = (await instancesFor(template.id)).length;
    expect(beforeCount).toBe(11);

    // Reassign, then extend the window forward so the new owner accrues work.
    await prisma.taskTemplate.update({
      where: { id: template.id },
      data: { assigneeId: fixture.otherMemberId },
    });
    await regenerateFutureInstances(prisma, template.id, TODAY, 5);

    // Move "today" forward five days so the new owner's instances are due.
    const later = addDays(TODAY, 5);
    const window = buildWindow({ days: 30 }, later);
    const report = await buildOrgReport(prisma, fixture.orgId, window);

    const alex = report.leaderboard.find((r) => r.userId === fixture.memberId);
    const brad = report.leaderboard.find((r) => r.userId === fixture.otherMemberId);

    // The eleven historical instances stay with Alex; the five new ones are Brad's.
    expect(alex?.assigned).toBe(11);
    expect(brad?.assigned).toBe(5);
    expect((alex?.assigned ?? 0) + (brad?.assigned ?? 0)).toBe(report.totals.assigned);
  });

  it("flags low-volume people and sinks them below everyone carrying a load", async () => {
    // Alex: plenty of work, imperfect. Brad: three tasks, all done.
    await createTemplate(fixture, {
      title: "Alex's daily",
      startDate: addDays(TODAY, -20),
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
      assigneeId: fixture.memberId,
    });
    await createTemplate(fixture, {
      title: "Brad's occasional",
      startDate: addDays(TODAY, -20),
      frequency: "WEEKLY",
      dayOfWeek: 1,
      assigneeId: fixture.otherMemberId,
    });
    await generateInstances(prisma, addDays(TODAY, -20), TODAY);

    const bradsWork = await prisma.taskInstance.findMany({
      where: { assigneeId: fixture.otherMemberId },
    });
    for (const instance of bradsWork) await completeInstance(prisma, instance.id, admin());

    const alexWork = await prisma.taskInstance.findMany({
      where: { assigneeId: fixture.memberId },
      orderBy: { dueDate: "asc" },
    });
    for (const [index, instance] of alexWork.entries()) {
      if (index % 10 !== 0) await completeInstance(prisma, instance.id, admin());
    }

    const report = await buildOrgReport(prisma, fixture.orgId, buildWindow({ days: 30 }, TODAY));
    const brad = report.leaderboard.find((r) => r.userId === fixture.otherMemberId);
    const alex = report.leaderboard.find((r) => r.userId === fixture.memberId);

    expect(brad?.assigned).toBeLessThan(LOW_VOLUME_THRESHOLD);
    expect(brad?.lowVolume).toBe(true);
    expect(brad?.completionRate).toBe(1);
    expect(alex?.lowVolume).toBe(false);
    // Brad is at 100% but must not top the table over Alex's twenty-one tasks.
    expect(report.leaderboard[0].userId).toBe(fixture.memberId);
  });

  it("ranks problem tasks worst-first and ignores anything under 5 instances", async () => {
    const bad = await createTemplate(fixture, {
      title: "The task nobody does",
      startDate: addDays(TODAY, -20),
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    });
    const good = await createTemplate(fixture, {
      title: "The task everyone does",
      startDate: addDays(TODAY, -20),
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    });
    const rare = await createTemplate(fixture, {
      title: "Barely happens",
      startDate: addDays(TODAY, -20),
      frequency: "MONTHLY",
      dayOfMonth: 15,
    });
    await generateInstances(prisma, addDays(TODAY, -20), TODAY);

    for (const instance of await instancesFor(good.id)) {
      await completeInstance(prisma, instance.id, admin());
    }
    for (const instance of await instancesFor(rare.id)) {
      await completeInstance(prisma, instance.id, admin());
    }
    await sweepMissed(prisma, TODAY, 2);

    const report = await buildOrgReport(prisma, fixture.orgId, buildWindow({ days: 30 }, TODAY));

    expect(report.problemTasks[0].templateId).toBe(bad.id);
    expect(report.problemTasks[0].completionRate).toBe(0);
    // A task everyone completes is not a problem, so it is not listed.
    expect(report.problemTasks.map((t) => t.templateId)).not.toContain(good.id);
    // One instance in the window is below the threshold, so it is not ranked.
    expect(report.problemTasks.map((t) => t.templateId)).not.toContain(rare.id);
    expect(report.problemTasks.every((t) => t.assigned >= PROBLEM_TASK_MIN_INSTANCES)).toBe(true);
    expect(report.problemTasks.every((t) => (t.completionRate ?? 1) < 1)).toBe(true);
  });

  it("builds a trend point for every day in the window, with a 7-day average", async () => {
    await buildHistory();
    const report = await buildOrgReport(prisma, fixture.orgId, buildWindow({ days: 30 }, TODAY));

    expect(report.trend).toHaveLength(30);
    expect(report.trend.at(-1)?.date).toBe(TODAY);
    // Days before the template started have nothing due, so no rate.
    expect(report.trend[0].assigned).toBe(0);
    expect(report.trend[0].completionRate).toBeNull();
    expect(report.trend.at(-1)?.assigned).toBe(1);
  });

  it("compares against the previous equivalent window", async () => {
    await createTemplate(fixture, {
      startDate: addDays(TODAY, -60),
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    });
    await generateInstances(prisma, addDays(TODAY, -60), TODAY);

    // Complete everything in the recent window only.
    const recent = await prisma.taskInstance.findMany({
      where: { dueDate: { gte: toDbDate(addDays(TODAY, -29)) } },
    });
    for (const instance of recent) await completeInstance(prisma, instance.id, admin());
    await sweepMissed(prisma, TODAY, 2);

    const report = await buildOrgReport(prisma, fixture.orgId, buildWindow({ days: 30 }, TODAY));

    expect(report.totals.completionRate).toBe(1);
    expect(report.previousTotals.completionRate).toBe(0);
    expect(report.deltas.completionRate).toBe(1);
    expect(report.deltas.completed).toBeGreaterThan(0);
  });

  it("attributes work to the instance snapshot, not the current template", async () => {
    const template = await createTemplate(fixture, {
      title: "September title",
      startDate: addDays(TODAY, -5),
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
      assigneeId: fixture.memberId,
    });
    await generateInstances(prisma, addDays(TODAY, -5), TODAY);

    await prisma.taskTemplate.update({
      where: { id: template.id },
      data: { title: "October title", assigneeId: fixture.otherMemberId },
    });

    const report = await buildOrgReport(prisma, fixture.orgId, buildWindow({ days: 30 }, TODAY));
    // Every historical instance is still Alex's, under the old title.
    expect(report.leaderboard).toHaveLength(1);
    expect(report.leaderboard[0].userId).toBe(fixture.memberId);
    expect(report.problemTasks[0].title).toBe("September title");
  });
});

describeDb("person report", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await seedFixture();
  });

  it("lists every missed task with its date and a per-category breakdown", async () => {
    await createTemplate(fixture, {
      title: "Missed daily",
      startDate: addDays(TODAY, -10),
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    });
    await generateInstances(prisma, addDays(TODAY, -10), TODAY);
    await sweepMissed(prisma, TODAY, 2);

    const report = await buildPersonReport(
      prisma,
      fixture.orgId,
      fixture.memberId,
      buildWindow({ days: 30 }, TODAY),
    );

    expect(report).not.toBeNull();
    expect(report!.missed.length).toBe(8); // 10 days back, minus the 2-day grace
    expect(report!.missed.every((m) => m.dueDate <= TODAY)).toBe(true);
    expect(report!.categories[0].name).toBe("Ops");
    expect(report!.history).toHaveLength(11);
  });

  it("returns null for a user in another organisation", async () => {
    const otherOrg = await prisma.organisation.create({ data: { name: "Someone else" } });
    const report = await buildPersonReport(
      prisma,
      otherOrg.id,
      fixture.memberId,
      buildWindow({ days: 30 }, TODAY),
    );
    expect(report).toBeNull();
  });
});

describeDb("CSV export", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await seedFixture();
  });

  it("exports the same number of rows as the panel shows (acceptance test 18)", async () => {
    await createTemplate(fixture, {
      startDate: addDays(TODAY, -20),
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
      assigneeId: fixture.memberId,
    });
    await createTemplate(fixture, {
      title: "Second",
      startDate: addDays(TODAY, -20),
      frequency: "WEEKLY",
      dayOfWeek: 3,
      assigneeId: fixture.otherMemberId,
    });
    await generateInstances(prisma, addDays(TODAY, -20), addDays(TODAY, 14));

    const window = buildWindow({ days: 30 }, TODAY);
    const report = await buildOrgReport(prisma, fixture.orgId, window);

    const leaderboardCsv = toCsv(
      ["person"],
      report.leaderboard.map((r) => [r.name]),
    );
    expect(countCsvRows(leaderboardCsv)).toBe(report.leaderboard.length);

    const trendCsv = toCsv(["date"], report.trend.map((p) => [p.date]));
    expect(countCsvRows(trendCsv)).toBe(report.trend.length);

    // The raw export must match the report's assigned count exactly — future
    // instances exist in the database but are outside the window.
    const rawRows = await prisma.taskInstance.count({
      where: {
        organisationId: fixture.orgId,
        dueDate: { gte: toDbDate(window.from), lte: toDbDate(window.to) },
      },
    });
    expect(rawRows).toBe(report.totals.assigned);
    expect(await prisma.taskInstance.count()).toBeGreaterThan(rawRows);
  });
});

describe("CSV formatting", () => {
  it("quotes commas, quotes and newlines", () => {
    const csv = toCsv(
      ["title", "note"],
      [["Stock, count", 'He said "done"'], ["Line\nbreak", null]],
    );
    expect(csv).toContain('"Stock, count"');
    expect(csv).toContain('"He said ""done"""');
    expect(csv).toContain('"Line\nbreak"');
  });

  it("neutralises a leading formula character", () => {
    const csv = toCsv(["title"], [["=cmd|calc"]]);
    expect(csv).toContain("'=cmd|calc");
  });
});

/** Rows excluding the header. */
function countCsvRows(csv: string): number {
  return csv.trimEnd().split("\r\n").length - 1;
}
