/**
 * Threads, and what counts as unread.
 *
 * The rules that matter are about reach and about noise. Reach: a thread must
 * not become invisible because its task aged off the day screen, which is the
 * whole complaint. Noise: an unread count that is ever wrong is one nobody
 * looks at twice, so your own words never count, and reading one thread must
 * not mark the others.
 */

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
import { generateInstances } from "@/lib/recurrence";
import {
  markThreadRead,
  threadsFor,
  threadsForMember,
  unreadCountFor,
} from "@/lib/messages";
import { addDays } from "@/lib/time";

const available = await databaseAvailable();
const describeDb = available ? describe : describe.skip;

const TODAY = "2026-09-24";

describeDb("message threads", () => {
  let fixture: Fixture;
  let bradsTask: string;
  let alexsTask: string;

  const brad = () => ({ id: fixture.memberId, organisationId: fixture.orgId, role: Role.MEMBER });
  const admin = () => ({ id: fixture.adminId, organisationId: fixture.orgId, role: Role.ADMIN });

  async function say(instanceId: string, authorId: string, body: string, at?: Date) {
    return prisma.comment.create({
      data: {
        organisationId: fixture.orgId,
        instanceId,
        authorId,
        body,
        ...(at ? { createdAt: at } : {}),
      },
    });
  }

  beforeEach(async () => {
    fixture = await seedFixture({ graceDays: 1 });

    const a = await createTemplate(fixture, {
      title: "Check the simulator bays",
      startDate: addDays(TODAY, -30),
      assigneeId: fixture.memberId,
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    });
    const b = await createTemplate(fixture, {
      title: "Pick and pack web orders",
      startDate: addDays(TODAY, -30),
      assigneeId: fixture.otherMemberId,
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    });
    await generateInstances(prisma, addDays(TODAY, -30), TODAY);
    bradsTask = (await instancesFor(a.id))[0].id;
    alexsTask = (await instancesFor(b.id))[0].id;
  });

  it("reaches a thread on a task far outside the day screen", async () => {
    // A month old, long since off /my-day, and the reason this page exists.
    await say(bradsTask, fixture.adminId, "Did bay 3 ever come back up?");

    const threads = await threadsFor(prisma, brad());
    expect(threads).toHaveLength(1);
    expect(threads[0].title).toBe("Check the simulator bays");
    expect(threads[0].unread).toBe(1);
  });

  it("gives an admin the reply to their own question on somebody else's task", async () => {
    await say(alexsTask, fixture.adminId, "Why did this slip?");
    await say(alexsTask, fixture.otherMemberId, "Courier did not turn up.");

    const threads = await threadsFor(prisma, admin());
    expect(threads.map((t) => t.id)).toEqual([alexsTask]);
    expect(threads[0].assignedToMe).toBe(false);
    // The admin wrote one of the two; only the answer is news.
    expect(threads[0].unread).toBe(1);
  });

  it("keeps other people's conversations out of it", async () => {
    await say(alexsTask, fixture.otherMemberId, "Nothing to do with Brad.");

    expect(await threadsFor(prisma, brad())).toEqual([]);
    expect(await unreadCountFor(prisma, brad())).toBe(0);
  });

  it("never counts your own words as unread", async () => {
    await say(bradsTask, fixture.memberId, "Bay 3 is still down.");
    expect(await unreadCountFor(prisma, brad())).toBe(0);

    await say(bradsTask, fixture.adminId, "Chase the engineer.");
    expect(await unreadCountFor(prisma, brad())).toBe(1);
  });

  it("clears a thread when it is read, and only that thread", async () => {
    await say(bradsTask, fixture.adminId, "One");
    const second = await createTemplate(fixture, {
      title: "Walk the range",
      startDate: TODAY,
      assigneeId: fixture.memberId,
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    });
    await generateInstances(prisma, TODAY, TODAY);
    const other = (await instancesFor(second.id))[0].id;
    await say(other, fixture.adminId, "Two");

    expect(await unreadCountFor(prisma, brad())).toBe(2);
    expect(await markThreadRead(prisma, brad(), bradsTask)).toBe(true);

    // The whole reason for a marker per thread rather than one stamp on the
    // user: reading one reply must not silence the other.
    expect(await unreadCountFor(prisma, brad())).toBe(1);
  });

  it("goes unread again when somebody replies after you read it", async () => {
    await say(bradsTask, fixture.adminId, "First");
    await markThreadRead(prisma, brad(), bradsTask);
    expect(await unreadCountFor(prisma, brad())).toBe(0);

    await say(bradsTask, fixture.adminId, "Second");
    expect(await unreadCountFor(prisma, brad())).toBe(1);
  });

  it("will not let somebody mark a thread they are not in", async () => {
    await say(alexsTask, fixture.otherMemberId, "Alex's business.");
    expect(await markThreadRead(prisma, brad(), alexsTask)).toBe(false);
    expect(await prisma.commentRead.count({ where: { userId: fixture.memberId } })).toBe(0);
  });

  it("orders by the last thing said, not by when the task was due", async () => {
    const old = await createTemplate(fixture, {
      title: "Ancient task",
      startDate: addDays(TODAY, -30),
      endDate: addDays(TODAY, -30),
      frequency: "ONE_OFF",
      assigneeId: fixture.memberId,
    });
    await generateInstances(prisma, addDays(TODAY, -30), TODAY);
    const ancient = (await instancesFor(old.id))[0].id;

    await say(bradsTask, fixture.adminId, "Weeks ago", new Date("2026-09-01T09:00:00Z"));
    await say(ancient, fixture.adminId, "This morning", new Date("2026-09-24T08:00:00Z"));

    const threads = await threadsFor(prisma, brad());
    // A month-old task answered this morning is the one you came here for.
    expect(threads.map((t) => t.title)).toEqual(["Ancient task", "Check the simulator bays"]);
  });

  it("carries the whole thread, oldest first, so it reads as a conversation", async () => {
    await say(bradsTask, fixture.adminId, "First", new Date("2026-09-20T09:00:00Z"));
    await say(bradsTask, fixture.memberId, "Second", new Date("2026-09-20T10:00:00Z"));
    await say(bradsTask, fixture.adminId, "Third", new Date("2026-09-20T11:00:00Z"));

    const [thread] = await threadsFor(prisma, brad());
    expect(thread.comments.map((c) => c.body)).toEqual(["First", "Second", "Third"]);
    expect(thread.comments.map((c) => c.mine)).toEqual([false, true, false]);
  });

  it("leaves a task with no comments out entirely", async () => {
    await prisma.taskInstance.update({
      where: { id: bradsTask },
      data: { status: InstanceStatus.COMPLETED, completedAt: new Date() },
    });
    expect(await threadsFor(prisma, brad())).toEqual([]);
  });
});

describeDb("an admin looking at somebody's messages", () => {
  let fixture: Fixture;
  let bradsTask: string;

  const brad = () => ({ id: fixture.memberId, organisationId: fixture.orgId, role: Role.MEMBER });
  const admin = () => ({ id: fixture.adminId, organisationId: fixture.orgId, role: Role.ADMIN });

  beforeEach(async () => {
    fixture = await seedFixture({ graceDays: 1 });
    const template = await createTemplate(fixture, {
      title: "Check the simulator bays",
      startDate: addDays(TODAY, -20),
      assigneeId: fixture.memberId,
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    });
    await generateInstances(prisma, addDays(TODAY, -20), TODAY);
    bradsTask = (await instancesFor(template.id))[0].id;
    await prisma.comment.create({
      data: {
        organisationId: fixture.orgId,
        instanceId: bradsTask,
        authorId: fixture.adminId,
        body: "Did bay 3 come back up?",
      },
    });
  });

  it("answers the question that brings anybody here: has he seen it", async () => {
    const viewed = await threadsForMember(prisma, admin(), fixture.memberId);

    expect(viewed!.person.name).toBe("Alex Member");
    // Unread by Brad, not by the admin who wrote it.
    expect(viewed!.threads[0].unread).toBe(1);

    await markThreadRead(prisma, brad(), bradsTask);
    const after = await threadsForMember(prisma, admin(), fixture.memberId);
    expect(after!.threads[0].unread).toBe(0);
  });

  it("writes nothing — looking is not reading", async () => {
    await threadsForMember(prisma, admin(), fixture.memberId);
    // Neither the member's marker, which would be a lie about their reading,
    // nor the admin's, which would silently clear their own badge.
    expect(await prisma.commentRead.count()).toBe(0);
  });

  it("refuses a member, and an id from another organisation", async () => {
    expect(await threadsForMember(prisma, brad(), fixture.adminId)).toBeNull();

    const elsewhere = await prisma.organisation.create({
      data: { name: "Somebody Else Ltd", timezone: "Europe/London" },
    });
    const outsider = await prisma.user.create({
      data: {
        organisationId: elsewhere.id,
        email: "outsider@elsewhere.local",
        name: "Outsider",
        passwordHash: "x",
        mustChangePassword: false,
      },
    });
    expect(await threadsForMember(prisma, admin(), outsider.id)).toBeNull();
    expect(await threadsForMember(prisma, admin(), "no-such-user")).toBeNull();
  });
});

describeDb("the everyone view", () => {
  let fixture: Fixture;
  let alexsTask: string;

  const brad = () => ({ id: fixture.memberId, organisationId: fixture.orgId, role: Role.MEMBER });
  const luke = () => ({ id: fixture.adminId, organisationId: fixture.orgId, role: Role.ADMIN });

  beforeEach(async () => {
    fixture = await seedFixture({ graceDays: 1 });
    const template = await createTemplate(fixture, {
      title: "Pick and pack web orders",
      startDate: TODAY,
      assigneeId: fixture.otherMemberId,
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    });
    await generateInstances(prisma, TODAY, TODAY);
    alexsTask = (await instancesFor(template.id))[0].id;
    // A conversation between two other people entirely.
    await prisma.comment.create({
      data: {
        organisationId: fixture.orgId,
        instanceId: alexsTask,
        authorId: fixture.otherMemberId,
        body: "Courier never turned up.",
      },
    });
  });

  it("shows an admin a conversation they are not in", async () => {
    // The whole complaint: one admin wrote the comments, so the other admin's
    // inbox was empty and there was no route to the team's conversations.
    expect(await threadsFor(prisma, luke(), "mine")).toEqual([]);

    const all = await threadsFor(prisma, luke(), "all");
    expect(all.map((t) => t.id)).toEqual([alexsTask]);
    expect(all[0].inThread).toBe(false);
  });

  it("does not count somebody else's conversation as unread", async () => {
    const all = await threadsFor(prisma, luke(), "all");
    // Reading over a thread is not being behind on it. A badge that is never
    // zero is a badge nobody reads.
    expect(all[0].unread).toBe(0);
    expect(await unreadCountFor(prisma, luke())).toBe(0);
  });

  it("still counts a thread the admin is actually in", async () => {
    await prisma.comment.create({
      data: {
        organisationId: fixture.orgId,
        instanceId: alexsTask,
        authorId: fixture.adminId,
        body: "Which courier?",
      },
    });
    await prisma.comment.create({
      data: {
        organisationId: fixture.orgId,
        instanceId: alexsTask,
        authorId: fixture.otherMemberId,
        body: "The usual one.",
      },
    });

    const all = await threadsFor(prisma, luke(), "all");
    expect(all[0].inThread).toBe(true);
    // Both of the other person's, since the admin has never opened it.
    expect(all[0].unread).toBe(2);
    expect(await unreadCountFor(prisma, luke())).toBe(2);
  });

  it("gives a member their own threads whatever scope they ask for", async () => {
    // Not an error: the option is never offered to them, so there is nothing
    // to refuse. Asking for it by hand simply gets them their own.
    expect(await threadsFor(prisma, brad(), "all")).toEqual([]);
  });

  it("does not cross organisations", async () => {
    const elsewhere = await prisma.organisation.create({
      data: { name: "Somebody Else Ltd", timezone: "Europe/London" },
    });
    const stranger = await prisma.user.create({
      data: {
        organisationId: elsewhere.id,
        email: "stranger@elsewhere.local",
        name: "Stranger",
        passwordHash: "x",
        mustChangePassword: false,
      },
    });
    const theirTemplate = await prisma.taskTemplate.create({
      data: {
        organisationId: elsewhere.id,
        title: "Not yours",
        frequency: "DAILY",
        daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
        startDate: new Date(TODAY),
        assigneeId: stranger.id,
        createdById: stranger.id,
      },
    });
    const theirs = await prisma.taskInstance.create({
      data: {
        organisationId: elsewhere.id,
        templateId: theirTemplate.id,
        assigneeId: stranger.id,
        title: "Not yours",
        dueDate: new Date(TODAY),
        dueAt: new Date(`${TODAY}T23:59:00Z`),
      },
    });
    await prisma.comment.create({
      data: {
        organisationId: elsewhere.id,
        instanceId: theirs.id,
        authorId: stranger.id,
        body: "Private.",
      },
    });

    const all = await threadsFor(prisma, luke(), "all");
    expect(all.map((t) => t.id)).not.toContain(theirs.id);
  });
});
