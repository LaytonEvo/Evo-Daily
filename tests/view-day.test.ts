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
    const viewed = await getDayFor(prisma, admin, fixture.otherMemberId, TODAY);
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
    const viewed = await getDayFor(prisma, admin, fixture.otherMemberId, TODAY);
    const titles = viewed!.day.dueToday.map((t) => t.title);
    expect(titles).not.toContain("Pick and pack web orders");
  });

  it("refuses a member, whatever id they ask for", async () => {
    const asMember = { role: Role.MEMBER, organisationId: fixture.orgId };
    expect(await getDayFor(prisma, asMember, fixture.otherMemberId, TODAY)).toBeNull();
    // Including their own — this route is not how anyone reads their own day.
    expect(await getDayFor(prisma, asMember, fixture.memberId, TODAY)).toBeNull();
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
    expect(await getDayFor(prisma, admin, outsider.id, TODAY)).toBeNull();
  });

  it("returns null rather than throwing for an id that does not exist", async () => {
    expect(await getDayFor(prisma, admin, "no-such-user", TODAY)).toBeNull();
  });

  it("still shows a deactivated person's day, and says they are deactivated", async () => {
    await prisma.user.update({
      where: { id: fixture.otherMemberId },
      data: { isActive: false },
    });

    const viewed = await getDayFor(prisma, admin, fixture.otherMemberId, TODAY);
    expect(viewed).not.toBeNull();
    expect(viewed!.person.isActive).toBe(false);
    expect(viewed!.day.dueToday).toHaveLength(1);
  });
});
