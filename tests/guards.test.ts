import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
import { databaseAvailable, prisma, resetDatabase } from "./helpers/db";

// The token is the only thing faked here. These tests are about whether the
// guard believes it.
const session = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/lib/auth", () => ({ auth: async () => session.value }));
vi.mock("@/lib/db", async () => ({ prisma: (await import("./helpers/db")).prisma }));

const { currentUser, requireUser, requireApiUser } = await import("@/lib/guards");

const available = await databaseAvailable();
const describeDb = available ? describe : describe.skip;

function signedInAs(id: string, claims: Record<string, unknown> = {}) {
  session.value = {
    user: {
      id,
      name: "Stale Name",
      email: "stale@example.com",
      role: Role.ADMIN,
      organisationId: "stale-org",
      mustChangePassword: true,
      ...claims,
    },
  };
}

describeDb("currentUser", () => {
  let userId: string;
  let orgId: string;

  beforeEach(async () => {
    await resetDatabase();
    const org = await prisma.organisation.create({
      data: { name: "Evolution Golf", timezone: "Europe/London" },
    });
    orgId = org.id;
    const user = await prisma.user.create({
      data: {
        organisationId: org.id,
        name: "Layton Brooks",
        email: "layton@example.com",
        passwordHash: "irrelevant",
        role: Role.MEMBER,
        isActive: true,
        mustChangePassword: false,
      },
    });
    userId = user.id;
    session.value = null;
  });

  it("returns null when there is no session", async () => {
    expect(await currentUser()).toBeNull();
  });

  it("clears mustChangePassword once saved, though the token still says otherwise", async () => {
    // Exactly the state that stranded the first real account: the change
    // succeeded, but the thirty-day token still carries the flag that forces
    // it. Believing the token sends them back to the screen they just
    // finished — and /login sends them there too, so there is no way out.
    signedInAs(userId, { mustChangePassword: true });

    expect((await currentUser())?.mustChangePassword).toBe(false);
  });

  it("still forces the change while the database says it is due", async () => {
    await prisma.user.update({ where: { id: userId }, data: { mustChangePassword: true } });
    signedInAs(userId, { mustChangePassword: false });

    expect((await currentUser())?.mustChangePassword).toBe(true);
  });

  it("treats a deactivated account as signed out", async () => {
    await prisma.user.update({ where: { id: userId }, data: { isActive: false } });
    signedInAs(userId);

    // The token stays valid for another month; the account does not.
    expect(await currentUser()).toBeNull();
  });

  it("treats a deleted account as signed out", async () => {
    await prisma.user.delete({ where: { id: userId } });
    signedInAs(userId);

    expect(await currentUser()).toBeNull();
  });

  it("takes role and organisation from the record, not the token", async () => {
    signedInAs(userId, { role: Role.ADMIN, organisationId: "stale-org" });

    const user = await currentUser();
    expect(user?.role).toBe(Role.MEMBER);
    expect(user?.organisationId).toBe(orgId);
    expect(user?.name).toBe("Layton Brooks");
    expect(user?.email).toBe("layton@example.com");
  });
});

/**
 * Which requests count as somebody using it.
 *
 * The first version recorded activity for every guarded request, which read as
 * obviously right and was not: the nav badge polls /api/me/unread once a
 * minute for as long as a tab is open, so a tab nobody was looking at scored a
 * visit every couple of minutes. On the first day live, four people showed
 * 45-48 visits each — near enough the same number for everybody, because it
 * was measuring how long their tabs had been open and nothing else.
 */
describeDb("what counts as activity", () => {
  let userId: string;

  beforeEach(async () => {
    await resetDatabase();
    const org = await prisma.organisation.create({
      data: { name: "Evolution Golf", timezone: "Europe/London" },
    });
    const user = await prisma.user.create({
      data: {
        organisationId: org.id,
        name: "Layton Brooks",
        email: "layton@example.com",
        passwordHash: "irrelevant",
        role: Role.MEMBER,
        isActive: true,
        mustChangePassword: false,
      },
    });
    userId = user.id;
    signedInAs(userId);
  });

  const visits = () =>
    prisma.dailyActivity.findMany({ where: { userId }, select: { visits: true } });

  it("counts a page load", async () => {
    await requireUser();
    expect(await visits()).toEqual([{ visits: 1 }]);
  });

  it("does not count a background poll of an API route", async () => {
    await requireApiUser();
    expect(await visits()).toEqual([]);
    const after = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(after.lastActiveAt).toBeNull();
  });

  it("does not count reading the current user on its own", async () => {
    await currentUser();
    expect(await visits()).toEqual([]);
  });
});
