/**
 * What gets done, and what gets dropped.
 *
 * Every rule here is a rule about what a manager concludes from the top of a
 * list. Rank it wrong and the panel points at the wrong task, which is worse
 * than pointing at nothing — somebody rewrites a rota over it.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { Frequency, InstanceStatus } from "@prisma/client";
import { databaseAvailable, prisma, seedFixture, type Fixture } from "./helpers/db";
import { buildOrgReport, buildWindow, RANKING_SIZE } from "@/lib/reports";
import { addDays, toDbDate } from "@/lib/time";

const available = await databaseAvailable();
const describeDb = available ? describe : describe.skip;

const TODAY = "2026-09-30";

describeDb("task rankings", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await seedFixture();
  });

  /**
   * One recurring task, with an outcome per day counting back from yesterday.
   * A template per task, because the schema allows one occurrence per day.
   */
  async function task(title: string, outcomes: InstanceStatus[], assigneeId?: string) {
    const template = await prisma.taskTemplate.create({
      data: {
        organisationId: fixture.orgId,
        title,
        frequency: Frequency.DAILY,
        daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
        startDate: toDbDate(addDays(TODAY, -outcomes.length)),
        assigneeId: assigneeId ?? fixture.memberId,
        createdById: fixture.adminId,
      },
    });

    for (const [index, status] of outcomes.entries()) {
      await prisma.taskInstance.create({
        data: {
          organisationId: fixture.orgId,
          templateId: template.id,
          dueDate: toDbDate(addDays(TODAY, -(index + 1))),
          title,
          assigneeId: assigneeId ?? fixture.memberId,
          status,
          completedAt:
            status === InstanceStatus.COMPLETED ? new Date(`${TODAY}T09:00:00Z`) : null,
        },
      });
    }
    return template.id;
  }

  const report = () =>
    buildOrgReport(prisma, fixture.orgId, buildWindow({ days: 30 }, TODAY));

  const DONE = InstanceStatus.COMPLETED;
  const GONE = InstanceStatus.MISSED;
  const OPEN = InstanceStatus.PENDING;

  it("ranks by how often a task is missed, not by its rate", async () => {
    // The rate says the monthly job is worse. The count says the daily one is
    // where the work is actually going undone, and the count is the question.
    await task("Range balls", Array(11).fill(GONE).concat(Array(9).fill(DONE)));
    await task("Deep clean the simulators", [GONE, GONE]);

    const { rankings } = await report();
    expect(rankings.missed.map((r) => r.title)).toEqual([
      "Range balls",
      "Deep clean the simulators",
    ]);
    expect(rankings.missed[0].count).toBe(11);
  });

  it("carries how often it was due, so 4 of 4 is not read as 4 of 40", async () => {
    await task("Lock the range", [GONE, GONE, GONE, GONE]);

    const [row] = (await report()).rankings.missed;
    expect(row.count).toBe(4);
    expect(row.assigned).toBe(4);
    expect(row.share).toBe(1);
  });

  it("shows what the team reaches for when the day is short", async () => {
    await task("Open the shop", Array(20).fill(DONE));
    await task("Post to Instagram", [DONE, GONE, GONE]);

    const { rankings } = await report();
    expect(rankings.completed[0].title).toBe("Open the shop");
    expect(rankings.completed[0].count).toBe(20);
  });

  it("leaves out a task with nothing on that side", async () => {
    await task("Never missed", Array(5).fill(DONE));

    const { rankings } = await report();
    expect(rankings.missed).toEqual([]);
    expect(rankings.completed.map((r) => r.title)).toEqual(["Never missed"]);
  });

  /**
   * Still open is not yet missed. The catch-up window has not run out on these
   * and counting them would report work as dropped that somebody is about to
   * do — the exact false alarm that teaches people to ignore a report.
   */
  it("does not count still-open work as missed", async () => {
    await task("Waiting on the engineer", [OPEN, OPEN, OPEN]);

    expect((await report()).rankings.missed).toEqual([]);
  });

  it("breaks a tie on the share, so the task missed nearly every time wins", async () => {
    await task("Almost always missed", [GONE, GONE, GONE, DONE]);
    await task("Occasionally missed", Array(3).fill(GONE).concat(Array(20).fill(DONE)));

    const { rankings } = await report();
    expect(rankings.missed.map((r) => r.title)).toEqual([
      "Almost always missed",
      "Occasionally missed",
    ]);
  });

  it("cuts the list but says how many there were", async () => {
    for (let i = 0; i < RANKING_SIZE + 3; i++) {
      await task(`Task ${String(i).padStart(2, "0")}`, [GONE]);
    }

    const { rankings } = await report();
    expect(rankings.missed).toHaveLength(RANKING_SIZE);
    expect(rankings.missedTasks).toBe(RANKING_SIZE + 3);
  });

  it("keeps to the window, so an old failure stops being news", async () => {
    await task("Long ago", [GONE]);
    await prisma.taskInstance.updateMany({
      where: { title: "Long ago" },
      data: { dueDate: toDbDate(addDays(TODAY, -200)) },
    });

    expect((await report()).rankings.missed).toEqual([]);
  });

  it("names the owner, because a task is somebody's", async () => {
    await task("Theirs", [GONE], fixture.otherMemberId);

    const [row] = (await report()).rankings.missed;
    expect(row.assigneeName).not.toBe("—");
  });

  it("does not reach into another organisation", async () => {
    await task("Ours", [GONE]);
    const other = await prisma.organisation.create({
      data: { name: "Someone else", timezone: "Europe/London" },
    });

    const theirs = await buildOrgReport(prisma, other.id, buildWindow({ days: 30 }, TODAY));
    expect(theirs.rankings.missed).toEqual([]);
  });
});
