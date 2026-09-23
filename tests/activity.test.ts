/**
 * Whether somebody is actually using it.
 *
 * The bug this replaces was not a crash: the People table said "Last seen" and
 * showed the last time a password was typed. A session lasts thirty days, so
 * somebody opening the app every morning appeared to have stopped a month ago.
 * A number that looks right and is not is worse than no number.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { databaseAvailable, prisma, seedFixture, type Fixture } from "./helpers/db";
import { ACTIVITY_THROTTLE_MS, recentActivity, recordActivity } from "@/lib/activity";
import { addDays } from "@/lib/time";

const available = await databaseAvailable();
const describeDb = available ? describe : describe.skip;

const TODAY = "2026-09-24";
const at = (day: string, time = "09:00") => new Date(`${day}T${time}:00Z`);

describeDb("recording activity", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await seedFixture();
  });

  const user = async () =>
    prisma.user.findUniqueOrThrow({
      where: { id: fixture.memberId },
      select: { id: true, lastActiveAt: true },
    });

  it("records somebody who has never been seen", async () => {
    expect(await recordActivity(prisma, await user(), at(TODAY))).toBe(true);

    const after = await user();
    expect(after.lastActiveAt).toEqual(at(TODAY));
    const days = await prisma.dailyActivity.findMany({ where: { userId: fixture.memberId } });
    expect(days).toHaveLength(1);
    expect(days[0].visits).toBe(1);
  });

  /**
   * The thing that looked wrong on the live screen: four people all showing
   * the same minute, as though one person opening the app had been credited to
   * the whole team. It was not that — but nothing here proved it wasn't, and
   * an accountability number nobody trusts is worth nothing.
   */
  it("credits the person who opened it and nobody else", async () => {
    const admin = await prisma.user.findUniqueOrThrow({
      where: { id: fixture.adminId },
      select: { id: true, lastActiveAt: true },
    });

    await recordActivity(prisma, await user(), at(TODAY));

    const untouched = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(untouched.lastActiveAt).toBeNull();

    const rows = await prisma.dailyActivity.findMany({ select: { userId: true } });
    expect(rows.map((r) => r.userId)).toEqual([fixture.memberId]);
  });

  it("does not write again within the throttle", async () => {
    await recordActivity(prisma, await user(), at(TODAY, "09:00"));
    const soon = new Date(at(TODAY, "09:00").getTime() + ACTIVITY_THROTTLE_MS - 1000);

    // Every guarded page load would otherwise be a write, and a tab on a
    // refresh loop would read as the busiest person in the business.
    expect(await recordActivity(prisma, await user(), soon)).toBe(false);
    const [day] = await prisma.dailyActivity.findMany({ where: { userId: fixture.memberId } });
    expect(day.visits).toBe(1);
  });

  it("counts again once the throttle has passed", async () => {
    await recordActivity(prisma, await user(), at(TODAY, "09:00"));
    const later = new Date(at(TODAY, "09:00").getTime() + ACTIVITY_THROTTLE_MS + 1000);
    expect(await recordActivity(prisma, await user(), later)).toBe(true);

    const [day] = await prisma.dailyActivity.findMany({ where: { userId: fixture.memberId } });
    expect(day.visits).toBe(2);
  });

  it("starts a new row on a new day rather than adding to yesterday", async () => {
    await recordActivity(prisma, await user(), at(addDays(TODAY, -1), "17:00"));
    await recordActivity(prisma, await user(), at(TODAY, "08:00"));

    const days = await prisma.dailyActivity.findMany({
      where: { userId: fixture.memberId },
      orderBy: { day: "asc" },
    });
    expect(days).toHaveLength(2);
    expect(days.every((d) => d.visits === 1)).toBe(true);
  });

  it("never throws, whatever the database does", async () => {
    // A usage statistic must not be the reason somebody cannot open their day.
    const broken = {
      $transaction: async () => {
        throw new Error("down");
      },
    } as unknown as typeof prisma;
    await expect(
      recordActivity(broken, { id: fixture.memberId, lastActiveAt: null }, at(TODAY)),
    ).resolves.toBe(false);
  });
});

describeDb("reading activity back", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await seedFixture();
  });

  it("returns the days somebody was in, newest first", async () => {
    for (const day of [addDays(TODAY, -4), addDays(TODAY, -1), TODAY]) {
      await prisma.dailyActivity.create({
        data: { userId: fixture.memberId, day: new Date(day), visits: 3, lastAt: at(day) },
      });
    }

    const rows = await recentActivity(prisma, fixture.orgId, 14, TODAY);
    expect(rows.get(fixture.memberId)!.days.map((d) => d.day)).toEqual([
      TODAY,
      addDays(TODAY, -1),
      addDays(TODAY, -4),
    ]);
  });

  it("leaves out anything older than the window", async () => {
    await prisma.dailyActivity.create({
      data: {
        userId: fixture.memberId,
        day: new Date(addDays(TODAY, -20)),
        visits: 9,
        lastAt: at(addDays(TODAY, -20)),
      },
    });
    const rows = await recentActivity(prisma, fixture.orgId, 14, TODAY);
    expect(rows.get(fixture.memberId)!.days).toEqual([]);
  });

  it("includes somebody who has never opened it, so they are visibly absent", async () => {
    const rows = await recentActivity(prisma, fixture.orgId, 14, TODAY);
    // The account nobody has ever used is the single most useful row here, and
    // leaving it out because it has no data is how it goes unnoticed.
    expect(rows.get(fixture.otherMemberId)).toMatchObject({ lastActiveAt: null, days: [] });
  });

  it("covers this organisation's people and nobody else's", async () => {
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
    await prisma.dailyActivity.create({
      data: { userId: stranger.id, day: new Date(TODAY), visits: 5, lastAt: at(TODAY) },
    });

    const rows = await recentActivity(prisma, fixture.orgId, 14, TODAY);
    // The people query is what scopes this — the activity rows are matched
    // against it, so a stranger's day has nowhere to land. Asserting on the
    // whole set rather than on one absent id, because the absent id would be
    // absent even if the scope were dropped.
    expect([...rows.keys()].sort()).toEqual(
      [fixture.adminId, fixture.memberId, fixture.otherMemberId].sort(),
    );
    expect(rows.has(stranger.id)).toBe(false);
  });
});
