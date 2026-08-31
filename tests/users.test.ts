import { Role } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { databaseAvailable, prisma, seedFixture, type Fixture } from "./helpers/db";
import { createUser, updateUser } from "@/lib/users";

const available = await databaseAvailable();
const describeDb = available ? describe : describe.skip;

describeDb("manager assignment", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await seedFixture();
  });

  /** An extra colleague, for chains longer than the fixture provides. */
  async function addPerson(name: string, managerId?: string) {
    return createUser(prisma, fixture.orgId, {
      name,
      email: `${name.toLowerCase()}@test.local`,
      password: "TestPassword1!",
      role: Role.MEMBER,
      ...(managerId ? { managerId } : {}),
    });
  }

  const setManager = (userId: string, managerId: string | null) =>
    updateUser(prisma, fixture.orgId, fixture.adminId, userId, { managerId });

  it("allows a straightforward reporting line", async () => {
    const updated = await setManager(fixture.memberId, fixture.adminId);
    expect(updated.managerId).toBe(fixture.adminId);
  });

  it("allows a chain several levels deep", async () => {
    const lead = await addPerson("Lead", fixture.adminId);
    const senior = await addPerson("Senior", lead.id);
    const junior = await addPerson("Junior", senior.id);

    expect(junior.managerId).toBe(senior.id);
    // Re-pointing the bottom of the chain higher up is not a loop.
    const moved = await setManager(junior.id, lead.id);
    expect(moved.managerId).toBe(lead.id);
  });

  it("rejects someone managing themselves", async () => {
    await expect(setManager(fixture.memberId, fixture.memberId)).rejects.toThrow(
      /their own manager/i,
    );
  });

  it("rejects a two-person loop (the case the old check missed)", async () => {
    // Alex reports to Brad.
    await setManager(fixture.memberId, fixture.otherMemberId);
    // Brad must not then report to Alex.
    await expect(setManager(fixture.otherMemberId, fixture.memberId)).rejects.toThrow(
      /reporting line/i,
    );
  });

  it("rejects a longer loop", async () => {
    const a = await addPerson("Ann");
    const b = await addPerson("Ben", a.id);
    const c = await addPerson("Cara", b.id);

    // Ann → Cara would close Ann → Cara → Ben → Ann.
    await expect(setManager(a.id, c.id)).rejects.toThrow(/reporting line/i);
  });

  it("leaves the stored manager untouched when it rejects", async () => {
    await setManager(fixture.memberId, fixture.otherMemberId);
    await expect(setManager(fixture.otherMemberId, fixture.memberId)).rejects.toThrow();

    const brad = await prisma.user.findUniqueOrThrow({
      where: { id: fixture.otherMemberId },
    });
    expect(brad.managerId).toBeNull();
  });

  it("lets a manager be cleared", async () => {
    await setManager(fixture.memberId, fixture.adminId);
    const cleared = await setManager(fixture.memberId, null);
    expect(cleared.managerId).toBeNull();
  });

  it("does not treat two people sharing a manager as a loop", async () => {
    await setManager(fixture.memberId, fixture.adminId);
    const second = await setManager(fixture.otherMemberId, fixture.adminId);
    expect(second.managerId).toBe(fixture.adminId);
  });

  it("rejects a manager from another organisation", async () => {
    const otherOrg = await prisma.organisation.create({ data: { name: "Someone else" } });
    const outsider = await prisma.user.create({
      data: {
        organisationId: otherOrg.id,
        email: "outsider@elsewhere.local",
        name: "Outsider",
        passwordHash: "x",
        role: Role.MEMBER,
      },
    });

    await expect(setManager(fixture.memberId, outsider.id)).rejects.toThrow(
      /not in this organisation/i,
    );
  });

  it("rejects a manager from another organisation at creation too", async () => {
    const otherOrg = await prisma.organisation.create({ data: { name: "Someone else" } });
    const outsider = await prisma.user.create({
      data: {
        organisationId: otherOrg.id,
        email: "outsider2@elsewhere.local",
        name: "Outsider",
        passwordHash: "x",
        role: Role.MEMBER,
      },
    });

    await expect(
      createUser(prisma, fixture.orgId, {
        name: "Newcomer",
        email: "newcomer@test.local",
        password: "TestPassword1!",
        role: Role.MEMBER,
        managerId: outsider.id,
      }),
    ).rejects.toThrow(/not in this organisation/i);
  });

  it("terminates even when the stored data already holds a loop", async () => {
    const a = await addPerson("Dana");
    const b = await addPerson("Eli", a.id);
    // Force a cycle straight into the database, bypassing the guard, as a
    // migration or a manual fix might have done.
    await prisma.user.update({ where: { id: a.id }, data: { managerId: b.id } });

    // Walking into that cycle must fail fast rather than hang.
    await expect(setManager(fixture.memberId, b.id)).rejects.toThrow(/reporting line/i);
  });
});
