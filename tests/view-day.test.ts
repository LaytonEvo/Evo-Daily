/**
 * An admin looking at somebody else's day.
 *
 * The screen is the easy half. The half worth testing is who is allowed to ask
 * and whose id they are allowed to ask about: the user id arrives in the URL,
 * so it is attacker-controlled, and "admin" on its own is not an answer when
 * the database holds more than one organisation.
 */

import { Role } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import {
  createTemplate,
  databaseAvailable,
  prisma,
  seedFixture,
  type Fixture,
} from "./helpers/db";
import { generateInstances } from "@/lib/recurrence";
import { getDayFor, getMyDay } from "@/lib/my-day";
import { addDays } from "@/lib/time";

const available = await databaseAvailable();
const describeDb = available ? describe : describe.skip;

const TODAY = "2026-08-27"; // Thursday

describeDb("viewing another person's day", () => {
  let fixture: Fixture;
  let admin: { role: Role; organisationId: string };

  beforeEach(async () => {
    fixture = await seedFixture();
    admin = { role: Role.ADMIN, organisationId: fixture.orgId };

    await createTemplate(fixture, {
      title: "Record range ball stock level",
      startDate: TODAY,
      assigneeId: fixture.otherMemberId,
    });
    await createTemplate(fixture, {
      title: "Pick and pack web orders",
      startDate: TODAY,
      assigneeId: fixture.memberId,
    });
    await generateInstances(prisma, TODAY, TODAY);
  });

  it("shows exactly what that person would see themselves", async () => {
    const viewed = await getDayFor(prisma, admin, fixture.otherMemberId, { today: TODAY });
    const theirOwn = await getMyDay(
      prisma,
      { id: fixture.otherMemberId, organisationId: fixture.orgId },
      TODAY,
    );

    expect(viewed).not.toBeNull();
    expect(viewed!.person.name).toBe("Brad Member");
    // Not "roughly the same": the point of the feature is that it is the same
    // screen, so anything that could drift is compared whole.
    expect(viewed!.day).toEqual(theirOwn);
    expect(viewed!.day.dueToday.map((t) => t.title)).toEqual([
      "Record range ball stock level",
    ]);
  });

  it("does not leak the viewer's own tasks into it", async () => {
    const viewed = await getDayFor(prisma, admin, fixture.otherMemberId, { today: TODAY });
    const titles = viewed!.day.dueToday.map((t) => t.title);
    expect(titles).not.toContain("Pick and pack web orders");
  });

  it("refuses a member, whatever id they ask for", async () => {
    const asMember = { role: Role.MEMBER, organisationId: fixture.orgId };
    expect(await getDayFor(prisma, asMember, fixture.otherMemberId, { today: TODAY })).toBeNull();
    // Including their own — this route is not how anyone reads their own day.
    expect(await getDayFor(prisma, asMember, fixture.memberId, { today: TODAY })).toBeNull();
  });

  it("refuses an id from another organisation", async () => {
    const otherOrg = await prisma.organisation.create({
      data: { name: "Somebody Else Ltd", timezone: "Europe/London" },
    });
    const outsider = await prisma.user.create({
      data: {
        organisationId: otherOrg.id,
        email: "outsider@elsewhere.local",
        name: "Outsider",
        passwordHash: await bcrypt.hash("TestPassword1!", 4),
        role: Role.MEMBER,
        mustChangePassword: false,
      },
    });

    // An admin of one organisation is nobody in another.
    expect(await getDayFor(prisma, admin, outsider.id, { today: TODAY })).toBeNull();
  });

  it("returns null rather than throwing for an id that does not exist", async () => {
    expect(await getDayFor(prisma, admin, "no-such-user", { today: TODAY })).toBeNull();
  });

  it("still shows a deactivated person's day, and says they are deactivated", async () => {
    await prisma.user.update({
      where: { id: fixture.otherMemberId },
      data: { isActive: false },
    });

    const viewed = await getDayFor(prisma, admin, fixture.otherMemberId, { today: TODAY });
    expect(viewed).not.toBeNull();
    expect(viewed!.person.isActive).toBe(false);
    expect(viewed!.day.dueToday).toHaveLength(1);
  });
});

describeDb("viewing tomorrow", () => {
  let fixture: Fixture;
  let admin: { role: Role; organisationId: string };
  const TOMORROW = addDays(TODAY, 1);

  beforeEach(async () => {
    fixture = await seedFixture();
    admin = { role: Role.ADMIN, organisationId: fixture.orgId };

    await createTemplate(fixture, {
      title: "Due tomorrow",
      startDate: TOMORROW,
      frequency: "ONE_OFF",
      endDate: TOMORROW,
      assigneeId: fixture.otherMemberId,
    });
    await createTemplate(fixture, {
      title: "Overdue from yesterday",
      startDate: addDays(TODAY, -1),
      frequency: "ONE_OFF",
      endDate: addDays(TODAY, -1),
      assigneeId: fixture.otherMemberId,
    });
    await generateInstances(prisma, addDays(TODAY, -1), TOMORROW);
  });

  it("shows what is due that day and says which day it is", async () => {
    const viewed = await getDayFor(prisma, admin, fixture.otherMemberId, {
      on: TOMORROW,
      today: TODAY,
    });

    expect(viewed!.on).toBe(TOMORROW);
    expect(viewed!.isToday).toBe(false);
    expect(viewed!.day.today).toBe(TOMORROW);
    expect(viewed!.day.dueToday.map((t) => t.title)).toEqual(["Due tomorrow"]);
  });

  it("does not drag today's backlog into it", async () => {
    // getMyDay reaches back across the grace window. Doing that from tomorrow
    // would relabel work that is overdue now as tomorrow's problem.
    const viewed = await getDayFor(prisma, admin, fixture.otherMemberId, {
      on: TOMORROW,
      today: TODAY,
    });

    expect(viewed!.day.overdue).toEqual([]);
    expect(viewed!.day.doneToday).toEqual([]);
    expect(viewed!.day.dueToday.map((t) => t.title)).not.toContain("Overdue from yesterday");
  });

  it("reads as a day nobody has started", async () => {
    const viewed = await getDayFor(prisma, admin, fixture.otherMemberId, {
      on: TOMORROW,
      today: TODAY,
    });
    expect(viewed!.day.owedDone).toBe(0);
    expect(viewed!.day.owedTotal).toBe(1);
  });

  it("still refuses a member", async () => {
    const asMember = { role: Role.MEMBER, organisationId: fixture.orgId };
    expect(
      await getDayFor(prisma, asMember, fixture.otherMemberId, { on: TOMORROW, today: TODAY }),
    ).toBeNull();
  });

  it("puts a starred task at the top of tomorrow too", async () => {
    const starred = await createTemplate(fixture, {
      title: "Starred, no cut-off",
      startDate: TOMORROW,
      frequency: "ONE_OFF",
      endDate: TOMORROW,
      assigneeId: fixture.otherMemberId,
    });
    await generateInstances(prisma, TOMORROW, TOMORROW);
    await prisma.taskTemplate.update({ where: { id: starred.id }, data: { isStarred: true } });

    const viewed = await getDayFor(prisma, admin, fixture.otherMemberId, {
      on: TOMORROW,
      today: TODAY,
    });
    expect(viewed!.day.dueToday[0].title).toBe("Starred, no cut-off");
  });

  it("clamps a past date to today rather than echoing it back", async () => {
    // History is the report's job, and it answers better. Showing today's list
    // under yesterday's date would be the one genuinely misleading outcome.
    const viewed = await getDayFor(prisma, admin, fixture.otherMemberId, {
      on: addDays(TODAY, -5),
      today: TODAY,
    });
    expect(viewed!.on).toBe(TODAY);
    expect(viewed!.isToday).toBe(true);
    expect(viewed!.day.today).toBe(TODAY);
  });
});
