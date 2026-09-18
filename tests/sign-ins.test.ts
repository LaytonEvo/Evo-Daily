import { Role, SignInOutcome } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { databaseAvailable, prisma, seedFixture, type Fixture } from "./helpers/db";
import {
  lastSeenByUser,
  recentSignIns,
  recordSignIn,
  signInsFor,
} from "@/lib/sign-ins";

const available = await databaseAvailable();
const describeDb = available ? describe : describe.skip;

describeDb("the sign-in log", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await seedFixture();
  });

  const record = (userId: string, outcome: SignInOutcome, at?: Date) =>
    at
      ? prisma.signIn.create({
          data: { userId, organisationId: fixture.orgId, outcome, at },
        })
      : recordSignIn(prisma, { userId, organisationId: fixture.orgId, outcome });

  it("records an attempt against a known account", async () => {
    await record(fixture.memberId, SignInOutcome.SUCCESS);

    const rows = await recentSignIns(prisma, fixture.orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0].outcome).toBe(SignInOutcome.SUCCESS);
    expect(rows[0].user.name).toBe("Alex Member");
  });

  it("returns the newest attempt first", async () => {
    const day = (n: number) => new Date(Date.UTC(2026, 8, n, 9, 0, 0));
    await record(fixture.memberId, SignInOutcome.SUCCESS, day(1));
    await record(fixture.memberId, SignInOutcome.WRONG_PASSWORD, day(3));
    await record(fixture.memberId, SignInOutcome.SUCCESS, day(2));

    const rows = await recentSignIns(prisma, fixture.orgId);
    expect(rows.map((r) => r.at.getUTCDate())).toEqual([3, 2, 1]);
  });

  it("reports when each person last actually got in", async () => {
    const day = (n: number) => new Date(Date.UTC(2026, 8, n, 9, 0, 0));
    await record(fixture.memberId, SignInOutcome.SUCCESS, day(1));
    await record(fixture.memberId, SignInOutcome.SUCCESS, day(5));
    await record(fixture.adminId, SignInOutcome.SUCCESS, day(2));

    const seen = await lastSeenByUser(prisma, fixture.orgId);
    expect(seen.get(fixture.memberId)?.getUTCDate()).toBe(5);
    expect(seen.get(fixture.adminId)?.getUTCDate()).toBe(2);
  });

  it("does not count a failed attempt as being seen", async () => {
    // A fortnight of wrong passwords means locked out, not active.
    await record(fixture.memberId, SignInOutcome.WRONG_PASSWORD);
    await record(fixture.memberId, SignInOutcome.DEACTIVATED);

    const seen = await lastSeenByUser(prisma, fixture.orgId);
    expect(seen.has(fixture.memberId)).toBe(false);
    // The attempts are still on the log — that is the point of recording them.
    expect(await recentSignIns(prisma, fixture.orgId)).toHaveLength(2);
  });

  it("leaves somebody who has never signed in out of the map entirely", async () => {
    const seen = await lastSeenByUser(prisma, fixture.orgId);
    expect(seen.size).toBe(0);
  });

  it("keeps one organisation's log out of another's", async () => {
    const elsewhere = await prisma.organisation.create({ data: { name: "Elsewhere" } });
    const theirs = await prisma.user.create({
      data: {
        organisationId: elsewhere.id,
        email: "someone@elsewhere.test",
        name: "Someone Else",
        passwordHash: "x",
        role: Role.MEMBER,
      },
    });
    await prisma.signIn.create({
      data: {
        userId: theirs.id,
        organisationId: elsewhere.id,
        outcome: SignInOutcome.SUCCESS,
      },
    });
    await record(fixture.memberId, SignInOutcome.SUCCESS);

    const ours = await recentSignIns(prisma, fixture.orgId);
    expect(ours).toHaveLength(1);
    expect(ours[0].user.id).toBe(fixture.memberId);
    expect((await lastSeenByUser(prisma, fixture.orgId)).has(theirs.id)).toBe(false);
  });

  it("returns one person's own attempts", async () => {
    await record(fixture.memberId, SignInOutcome.SUCCESS);
    await record(fixture.adminId, SignInOutcome.SUCCESS);

    const rows = await signInsFor(prisma, fixture.orgId, fixture.memberId);
    expect(rows).toHaveLength(1);
    expect(rows[0].user.id).toBe(fixture.memberId);
  });

  it("goes with the account when it is deleted", async () => {
    // Otherwise clearing out a demo account fails on its own audit trail.
    await record(fixture.otherMemberId, SignInOutcome.SUCCESS);
    await prisma.user.delete({ where: { id: fixture.otherMemberId } });

    expect(await recentSignIns(prisma, fixture.orgId)).toEqual([]);
  });

  it("never lets a failed write stop somebody signing in", async () => {
    // The organisation is gone, so the row cannot be written. recordSignIn
    // must swallow that rather than throw into the auth path.
    await expect(
      recordSignIn(prisma, {
        userId: fixture.memberId,
        organisationId: "does-not-exist",
        outcome: SignInOutcome.SUCCESS,
      }),
    ).resolves.toBeUndefined();
  });
});
