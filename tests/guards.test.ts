import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
import { databaseAvailable, prisma, resetDatabase } from "./helpers/db";

// The token is the only thing faked here. These tests are about whether the
// guard believes it.
const session = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/lib/auth", () => ({ auth: async () => session.value }));
vi.mock("@/lib/db", async () => ({ prisma: (await import("./helpers/db")).prisma }));

const { currentUser } = await import("@/lib/guards");

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
