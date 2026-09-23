/**
 * Asking why a day came in under half.
 *
 * The question is compulsory, which makes every one of these rules a rule
 * about when to interrupt somebody's morning. Getting the boundary wrong in
 * one direction asks a person to account for a day they were on holiday for;
 * in the other, it never fires at all.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { Frequency, InstanceStatus, Role } from "@prisma/client";
import { databaseAvailable, prisma, seedFixture, type Fixture } from "./helpers/db";
import { pendingDayCheck, saveDayCheck } from "@/lib/day-check";
import { replyToDayCheck, threadsFor } from "@/lib/messages";
import { addDays, toDbDate } from "@/lib/time";

const available = await databaseAvailable();
const describeDb = available ? describe : describe.skip;

const TODAY = "2026-09-24";
const YESTERDAY = addDays(TODAY, -1);

describeDb("the under-half day check", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await seedFixture();
  });

  /**
   * Tasks due on a day, with the statuses given. One template each, because
   * the schema allows a template only one occurrence per day — which is the
   * rule that stops a task appearing twice on somebody's list.
   */
  async function dayOf(statuses: InstanceStatus[], options: { on?: string; who?: string } = {}) {
    const day = options.on ?? YESTERDAY;
    const assigneeId = options.who ?? fixture.memberId;

    for (const [index, status] of statuses.entries()) {
      const template = await prisma.taskTemplate.create({
        data: {
          organisationId: fixture.orgId,
          title: `Task ${index + 1}`,
          frequency: Frequency.DAILY,
          daysOfWeek: [1, 2, 3, 4, 5],
          startDate: toDbDate(day),
          assigneeId,
          createdById: fixture.adminId,
        },
      });

      await prisma.taskInstance.create({
        data: {
          organisationId: fixture.orgId,
          templateId: template.id,
          dueDate: toDbDate(day),
          title: `Task ${index + 1}`,
          assigneeId,
          status,
          completedAt: status === InstanceStatus.COMPLETED ? new Date() : null,
        },
      });
    }
  }

  const member = () => ({ id: fixture.memberId, organisationId: fixture.orgId });
  const ask = () => pendingDayCheck(prisma, member(), TODAY);

  const DONE = InstanceStatus.COMPLETED;
  const OPEN = InstanceStatus.PENDING;
  const GONE = InstanceStatus.MISSED;

  it("asks when yesterday came in under half", async () => {
    await dayOf([DONE, DONE, DONE, OPEN, OPEN, OPEN, OPEN, OPEN]);

    const prompt = await ask();
    expect(prompt).not.toBeNull();
    expect(prompt!.completed).toBe(3);
    expect(prompt!.total).toBe(8);
    expect(prompt!.day).toBe(YESTERDAY);
  });

  it("stays quiet at exactly half, because half is not under half", async () => {
    await dayOf([DONE, DONE, DONE, OPEN, OPEN, OPEN]);
    expect(await ask()).toBeNull();
  });

  it("stays quiet when nothing was due, so a weekend never asks", async () => {
    expect(await ask()).toBeNull();
  });

  /**
   * The catch-up window leaves yesterday's unfinished work PENDING until
   * tonight's sweep. Counting misses instead of completions would mean the
   * question could not fire on the one morning it is worth asking.
   */
  it("counts what was finished, not what has been written off yet", async () => {
    await dayOf([DONE, OPEN, OPEN, OPEN]);

    const prompt = await ask();
    expect(prompt!.completed).toBe(1);
    expect(prompt!.total).toBe(4);
  });

  it("leaves booked time off out of both halves of the fraction", async () => {
    // One done, one not, and six excused: a half day, not a bad day.
    await dayOf([DONE, OPEN, ...Array(6).fill(InstanceStatus.EXCUSED)]);
    expect(await ask()).toBeNull();
  });

  it("names the tasks that were not done", async () => {
    await dayOf([DONE, OPEN, GONE]);

    const prompt = await ask();
    expect(prompt!.missed).toEqual(["Task 2", "Task 3"]);
  });

  /**
   * The first version bounded the day with London-midnight timestamps against
   * a DATE column, which quietly pulled in the day before: a morning with four
   * tasks on it was reported to the managers as 1 of 8.
   */
  it("asks about yesterday and not about the day before it", async () => {
    await dayOf([GONE, GONE, GONE, GONE], { on: addDays(YESTERDAY, -1) });
    await dayOf([DONE, OPEN, OPEN, OPEN]);

    const prompt = await ask();
    expect(prompt!.total).toBe(4);
    expect(prompt!.completed).toBe(1);
  });

  it("asks about yesterday and not about today", async () => {
    await dayOf([OPEN, OPEN], { on: TODAY });
    expect(await ask()).toBeNull();
  });

  it("counts only this person's tasks", async () => {
    await dayOf([OPEN, OPEN, OPEN, OPEN], { who: fixture.otherMemberId });
    expect(await ask()).toBeNull();
  });

  it("does not ask twice once it has been answered", async () => {
    await dayOf([DONE, OPEN, OPEN, OPEN]);
    expect(await saveDayCheck(prisma, member(), "Covering the shop all day.", TODAY)).toEqual({
      ok: true,
    });

    expect(await ask()).toBeNull();
  });

  it("turns away an answer too short to have been thought about", async () => {
    await dayOf([DONE, OPEN, OPEN, OPEN]);

    const result = await saveDayCheck(prisma, member(), "busy", TODAY);
    expect(result.ok).toBe(false);
    expect(await prisma.dayCheck.count()).toBe(0);
  });

  it("turns away an answer for a day with nothing to answer for", async () => {
    const result = await saveDayCheck(prisma, member(), "Nothing went wrong at all.", TODAY);
    expect(result.ok).toBe(false);
    expect(await prisma.dayCheck.count()).toBe(0);
  });

  /**
   * The figures are a record, and the tasks behind them keep moving: the sweep
   * runs, somebody marks work done late, an admin edits a title. A reason read
   * in six weeks has to sit next to the day it was written about.
   */
  it("keeps the numbers as they were when the answer was given", async () => {
    await dayOf([DONE, OPEN, OPEN, OPEN]);
    await saveDayCheck(prisma, member(), "Covering the shop all day.", TODAY);

    await prisma.taskInstance.updateMany({
      where: { assigneeId: fixture.memberId },
      data: { status: DONE, completedAt: new Date() },
    });

    const check = await prisma.dayCheck.findFirstOrThrow();
    expect(check.completed).toBe(1);
    expect(check.total).toBe(4);
  });
});

describeDb("where the answer lands", () => {
  let fixture: Fixture;

  const admin = () => ({
    id: fixture.adminId,
    organisationId: fixture.orgId,
    role: Role.ADMIN,
  });
  const member = () => ({
    id: fixture.memberId,
    organisationId: fixture.orgId,
    role: Role.MEMBER,
  });
  const other = () => ({
    id: fixture.otherMemberId,
    organisationId: fixture.orgId,
    role: Role.MEMBER,
  });

  beforeEach(async () => {
    fixture = await seedFixture();
    await prisma.dayCheck.create({
      data: {
        organisationId: fixture.orgId,
        userId: fixture.memberId,
        day: toDbDate(YESTERDAY),
        completed: 3,
        total: 8,
        reason: "On the shop floor all afternoon covering Alex.",
      },
    });
  });

  const threadsOf = async (viewer: { id: string; organisationId: string; role: Role }) =>
    (await threadsFor(prisma, viewer)).filter((t) => t.kind === "day-check");

  it("reaches the admins, which is the whole point of asking", async () => {
    const threads = await threadsOf(admin());
    expect(threads).toHaveLength(1);
    expect(threads[0].title).toBe("Under half — 3 of 8 done");
    expect(threads[0].comments[0].body).toContain("covering Alex");
  });

  it("arrives unread, so it is not missed among the task threads", async () => {
    const threads = await threadsOf(admin());
    expect(threads[0].unread).toBe(1);
  });

  it("is visible to the person who wrote it, and not as news to them", async () => {
    const threads = await threadsOf(member());
    expect(threads).toHaveLength(1);
    expect(threads[0].unread).toBe(0);
  });

  it("is not another member's business", async () => {
    expect(await threadsOf(other())).toHaveLength(0);
  });

  it("carries an admin's reply back to the person it is about", async () => {
    const [thread] = await threadsOf(admin());
    expect(await replyToDayCheck(prisma, admin(), thread.id, "Understood — thanks.")).toBe(true);

    const [seen] = await threadsOf(member());
    expect(seen.comments.map((c) => c.body)).toEqual([
      "On the shop floor all afternoon covering Alex.",
      "Understood — thanks.",
    ]);
    expect(seen.unread).toBe(1);
  });

  it("refuses a reply from a member it has nothing to do with", async () => {
    const [thread] = await threadsOf(admin());
    expect(await replyToDayCheck(prisma, other(), thread.id, "Nosy.")).toBe(false);
    expect(await prisma.dayCheckReply.count()).toBe(0);
  });
});
