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
import {
  deleteTemplate,
  reassignTemplates,
  setTemplateActive,
  updateTemplate,
} from "@/lib/templates";
import { generateInstances } from "@/lib/recurrence";
import { createAbsence } from "@/lib/absences";
import { addDays, toDbDate, todayInLondon } from "@/lib/time";

const available = await databaseAvailable();
const describeDb = available ? describe : describe.skip;

const TODAY = todayInLondon();

describeDb("deleting a task", () => {
  let fixture: Fixture;
  const admin = () => ({ id: fixture.adminId, role: Role.ADMIN, organisationId: fixture.orgId });

  beforeEach(async () => {
    fixture = await seedFixture();
  });

  const add = (title: string) =>
    createTemplate(fixture, { title, startDate: addDays(TODAY, -30) });

  it("removes a task nothing has happened to yet", async () => {
    const template = await add("Partner outreach (copy)");
    await generateInstances(prisma, TODAY, addDays(TODAY, 14));
    expect((await instancesFor(template.id)).length).toBeGreaterThan(0);

    const gone = await deleteTemplate(prisma, fixture.orgId, template.id);

    expect(gone.title).toBe("Partner outreach (copy)");
    expect(await prisma.taskTemplate.findUnique({ where: { id: template.id } })).toBeNull();
    // Unstarted work is not a record, so it goes with it.
    expect(await instancesFor(template.id)).toEqual([]);
  });

  it("refuses a task with a day on the record, and says how many", async () => {
    const template = await add("Clear the support inbox");
    await generateInstances(prisma, addDays(TODAY, -30), addDays(TODAY, 14));
    const [first, second] = await instancesFor(template.id);
    await prisma.taskInstance.updateMany({
      where: { id: { in: [first.id, second.id] } },
      data: { status: InstanceStatus.COMPLETED, completedAt: new Date() },
    });

    await expect(deleteTemplate(prisma, fixture.orgId, template.id)).rejects.toThrow(
      /2 days on the record.*Turn it off instead/s,
    );
    expect(await prisma.taskTemplate.findUnique({ where: { id: template.id } })).not.toBeNull();
  });

  it("counts a missed day as a record too", async () => {
    const template = await add("Wipe down the studio");
    await generateInstances(prisma, addDays(TODAY, -30), addDays(TODAY, 14));
    const [first] = await instancesFor(template.id);
    await prisma.taskInstance.update({
      where: { id: first.id },
      data: { status: InstanceStatus.MISSED },
    });

    await expect(deleteTemplate(prisma, fixture.orgId, template.id)).rejects.toThrow(
      /1 day on the record/,
    );
  });

  it("refuses a task whose only mark is a comment", async () => {
    const template = await add("Check the simulator");
    await generateInstances(prisma, TODAY, addDays(TODAY, 14));
    const [first] = await instancesFor(template.id);
    await prisma.comment.create({
      data: {
        organisationId: fixture.orgId,
        instanceId: first.id,
        authorId: fixture.memberId,
        body: "Bay 2 is still down.",
      },
    });

    await expect(deleteTemplate(prisma, fixture.orgId, template.id)).rejects.toThrow(
      /1 comment.*Turn it off instead/s,
    );
  });

  it("deletes a deactivated task that never ran", async () => {
    const template = await add("Typed in twice");
    await setTemplateActive(prisma, fixture.orgId, template.id, false, TODAY);

    await deleteTemplate(prisma, fixture.orgId, template.id);
    expect(await prisma.taskTemplate.findUnique({ where: { id: template.id } })).toBeNull();
  });

  it("takes the cover rows on a booked absence with it", async () => {
    const template = await add("Covered while away");
    await generateInstances(prisma, TODAY, addDays(TODAY, 14));
    await createAbsence(prisma, admin(), {
      userId: fixture.memberId,
      from: addDays(TODAY, 1),
      to: addDays(TODAY, 3),
      coverUserId: fixture.otherMemberId,
      covers: [{ templateId: template.id, coverUserId: fixture.otherMemberId }],
    });
    expect(await prisma.absenceCover.count({ where: { templateId: template.id } })).toBe(1);

    await deleteTemplate(prisma, fixture.orgId, template.id);

    expect(await prisma.absenceCover.count({ where: { templateId: template.id } })).toBe(0);
  });

  it("will not reach into another organisation", async () => {
    const template = await add("Ours");
    const elsewhere = await prisma.organisation.create({ data: { name: "Elsewhere" } });

    await expect(deleteTemplate(prisma, elsewhere.id, template.id)).rejects.toThrow(
      /not found/i,
    );
    expect(await prisma.taskTemplate.findUnique({ where: { id: template.id } })).not.toBeNull();
  });
});

describeDb("reassigning a task", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await seedFixture();
  });

  /** A daily task owned by the member, running from a week ago. */
  const daily = () =>
    createTemplate(fixture, {
      title: "Publish today's instant deals",
      startDate: addDays(TODAY, -7),
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
      assigneeId: fixture.memberId,
    });

  it("moves today's still-open task to the new owner", async () => {
    const template = await daily();
    await generateInstances(prisma, addDays(TODAY, -7), addDays(TODAY, 14));

    await reassignTemplates(prisma, fixture.orgId, [template.id], fixture.otherMemberId, TODAY);

    const today = await prisma.taskInstance.findFirstOrThrow({
      where: { templateId: template.id, dueDate: toDbDate(TODAY) },
    });
    expect(today.assigneeId).toBe(fixture.otherMemberId);
  });

  it("leaves an overdue open day with the person who sat on it", async () => {
    const template = await daily();
    await generateInstances(prisma, addDays(TODAY, -7), addDays(TODAY, 14));

    await reassignTemplates(prisma, fixture.orgId, [template.id], fixture.otherMemberId, TODAY);

    const yesterday = await prisma.taskInstance.findFirstOrThrow({
      where: { templateId: template.id, dueDate: toDbDate(addDays(TODAY, -1)) },
    });
    expect(yesterday.assigneeId).toBe(fixture.memberId);
  });

  it("never moves a day that is already on the record", async () => {
    const template = await daily();
    await generateInstances(prisma, addDays(TODAY, -7), addDays(TODAY, 14));
    await prisma.taskInstance.updateMany({
      where: { templateId: template.id, dueDate: toDbDate(TODAY) },
      data: { status: InstanceStatus.COMPLETED, completedAt: new Date() },
    });

    await reassignTemplates(prisma, fixture.orgId, [template.id], fixture.otherMemberId, TODAY);

    const today = await prisma.taskInstance.findFirstOrThrow({
      where: { templateId: template.id, dueDate: toDbDate(TODAY) },
    });
    // Completed by the member: moving it would hand someone else the credit.
    expect(today.assigneeId).toBe(fixture.memberId);
  });

  it("does the same when the owner is changed from the edit drawer", async () => {
    const template = await daily();
    await generateInstances(prisma, addDays(TODAY, -7), addDays(TODAY, 14));

    await updateTemplate(
      prisma,
      fixture.orgId,
      template.id,
      {
        title: template.title,
        assigneeId: fixture.otherMemberId,
        frequency: template.frequency,
        daysOfWeek: template.daysOfWeek,
        startDate: TODAY,
        isActive: true,
        isStarred: false,
      },
      TODAY,
    );

    const today = await prisma.taskInstance.findFirstOrThrow({
      where: { templateId: template.id, dueDate: toDbDate(TODAY) },
    });
    expect(today.assigneeId).toBe(fixture.otherMemberId);
  });

  it("leaves a missed day alone", async () => {
    const template = await daily();
    await generateInstances(prisma, addDays(TODAY, -7), addDays(TODAY, 14));
    await prisma.taskInstance.updateMany({
      where: { templateId: template.id, dueDate: toDbDate(addDays(TODAY, -5)) },
      data: { status: InstanceStatus.MISSED },
    });

    await reassignTemplates(prisma, fixture.orgId, [template.id], fixture.otherMemberId, TODAY);

    const missed = await prisma.taskInstance.findFirstOrThrow({
      where: { templateId: template.id, dueDate: toDbDate(addDays(TODAY, -5)) },
    });
    expect(missed.assigneeId).toBe(fixture.memberId);
  });
});
