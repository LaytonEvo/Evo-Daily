/**
 * Accepting a late tick.
 *
 * The badge that started this said "Completed late" on work that had been done
 * on time and ticked off in the evening. An on-time rate that cannot tell that
 * apart from work that actually ran late is a number people argue with instead
 * of acting on — so an admin can accept one, and the rate reads the acceptance.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { Frequency, InstanceStatus, Role } from "@prisma/client";
import { databaseAvailable, prisma, seedFixture, type Fixture } from "./helpers/db";
import { approveLate, TransitionError } from "@/lib/instances";
import { countsAsLate, totalsOf } from "@/lib/reports";
import { toDbDate } from "@/lib/time";

const available = await databaseAvailable();
const describeDb = available ? describe : describe.skip;

const DAY = "2026-09-28";

describeDb("approving a late completion", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await seedFixture();
  });

  const admin = () => ({
    id: fixture.adminId,
    role: Role.ADMIN,
    organisationId: fixture.orgId,
  });
  const member = () => ({
    id: fixture.memberId,
    role: Role.MEMBER,
    organisationId: fixture.orgId,
  });

  async function instance(
    options: { status?: InstanceStatus; wasLate?: boolean } = {},
  ): Promise<string> {
    const template = await prisma.taskTemplate.create({
      data: {
        organisationId: fixture.orgId,
        title: "Check competitor pricing",
        frequency: Frequency.DAILY,
        daysOfWeek: [1, 2, 3, 4, 5],
        startDate: toDbDate(DAY),
        assigneeId: fixture.memberId,
        createdById: fixture.adminId,
      },
    });
    const row = await prisma.taskInstance.create({
      data: {
        organisationId: fixture.orgId,
        templateId: template.id,
        dueDate: toDbDate(DAY),
        title: "Check competitor pricing",
        assigneeId: fixture.memberId,
        status: options.status ?? InstanceStatus.COMPLETED,
        completedAt: new Date(`${DAY}T18:53:00Z`),
        wasLate: options.wasLate ?? true,
      },
    });
    return row.id;
  }

  it("records who accepted it and when", async () => {
    const id = await instance();
    await approveLate(prisma, id, admin(), { now: new Date(`${DAY}T20:00:00Z`) });

    const after = await prisma.taskInstance.findUniqueOrThrow({ where: { id } });
    expect(after.lateApprovedAt).toEqual(new Date(`${DAY}T20:00:00Z`));
    expect(after.lateApprovedById).toBe(fixture.adminId);
  });

  /**
   * The record of what happened must not edit itself when somebody objects to
   * it. The badge still reads "Completed late"; the approval sits beside it.
   */
  it("leaves wasLate alone, because it is still true", async () => {
    const id = await instance();
    await approveLate(prisma, id, admin());

    const after = await prisma.taskInstance.findUniqueOrThrow({ where: { id } });
    expect(after.wasLate).toBe(true);
  });

  it("can be taken back", async () => {
    const id = await instance();
    await approveLate(prisma, id, admin());
    await approveLate(prisma, id, admin(), { approved: false });

    const after = await prisma.taskInstance.findUniqueOrThrow({ where: { id } });
    expect(after.lateApprovedAt).toBeNull();
    expect(after.lateApprovedById).toBeNull();
  });

  it("is not something a member can do to their own lateness", async () => {
    const id = await instance();
    await expect(approveLate(prisma, id, member())).rejects.toBeInstanceOf(TransitionError);

    const after = await prisma.taskInstance.findUniqueOrThrow({ where: { id } });
    expect(after.lateApprovedAt).toBeNull();
  });

  it("refuses a task that was not completed late, rather than writing a fact no screen shows", async () => {
    const id = await instance({ wasLate: false });
    await expect(approveLate(prisma, id, admin())).rejects.toBeInstanceOf(TransitionError);
  });

  it("refuses a task that is still open", async () => {
    const id = await instance({ status: InstanceStatus.PENDING });
    await expect(approveLate(prisma, id, admin())).rejects.toBeInstanceOf(TransitionError);
  });

  it("does not reach into another organisation", async () => {
    const id = await instance();
    const outsider = { id: fixture.adminId, role: Role.ADMIN, organisationId: "someone-else" };
    await expect(approveLate(prisma, id, outsider)).rejects.toBeInstanceOf(TransitionError);

    const after = await prisma.taskInstance.findUniqueOrThrow({ where: { id } });
    expect(after.lateApprovedAt).toBeNull();
  });
});

describe("what the on-time rate counts", () => {
  const row = (wasLate: boolean, lateApprovedAt: Date | null) => ({
    status: InstanceStatus.COMPLETED,
    wasLate,
    lateApprovedAt,
  });

  it("counts an approved late tick as on time", () => {
    const totals = totalsOf([
      row(false, null),
      row(true, new Date()),
      row(true, null),
    ]);

    expect(totals.completed).toBe(3);
    expect(totals.onTime).toBe(2);
  });

  it("still counts an unapproved late tick against the rate", () => {
    expect(countsAsLate(row(true, null))).toBe(true);
    expect(countsAsLate(row(true, new Date()))).toBe(false);
    expect(countsAsLate(row(false, null))).toBe(false);
  });

  /**
   * Dates arrive as strings once a row has crossed to the client, and the same
   * predicate runs on both sides. A truthiness check that only understood Date
   * would quietly count every approved task as late in the browser.
   */
  it("reads an approval that has been serialised to a string", () => {
    expect(countsAsLate({ wasLate: true, lateApprovedAt: "2026-09-28T20:00:00.000Z" })).toBe(
      false,
    );
  });
});
