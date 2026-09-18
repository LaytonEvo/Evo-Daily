/**
 * Deleting a task that has a record, on purpose.
 *
 * The refusal is still the default and still right — a completion rate that
 * changes because somebody tidied up is not a completion rate. But an admin who
 * has been shown what it costs is allowed to accept it, and the thing worth
 * testing is that the escape hatch is exactly as narrow as it looks: nothing
 * gets past the guard without asking for it by name.
 */

import { InstanceStatus } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTemplate,
  databaseAvailable,
  instancesFor,
  prisma,
  seedFixture,
  type Fixture,
} from "./helpers/db";
import { generateInstances } from "@/lib/recurrence";
import { addDays } from "@/lib/time";

// The bucket is not part of this: assert the keys we asked it to drop.
const removed = vi.hoisted(() => ({ keys: [] as string[] }));
vi.mock("@/lib/storage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/storage")>("@/lib/storage");
  return {
    ...actual,
    deleteObject: async (key: string) => {
      removed.keys.push(key);
    },
  };
});

const { deleteTemplate, deleteTemplates, deleteImpact } = await import("@/lib/templates");

const available = await databaseAvailable();
const describeDb = available ? describe : describe.skip;

const TODAY = "2026-08-27";

describeDb("deleting a task that has history", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await seedFixture();
    removed.keys = [];
  });

  const add = (title: string) =>
    createTemplate(fixture, { title, startDate: addDays(TODAY, -30) });

  /** A task with two completed days, one comment and one attachment on it. */
  async function withRecord(title: string) {
    const template = await add(title);
    await generateInstances(prisma, addDays(TODAY, -30), addDays(TODAY, 14));
    const [first, second] = await instancesFor(template.id);
    await prisma.taskInstance.updateMany({
      where: { id: { in: [first.id, second.id] } },
      data: { status: InstanceStatus.COMPLETED, completedAt: new Date() },
    });
    const comment = await prisma.comment.create({
      data: {
        organisationId: fixture.orgId,
        instanceId: first.id,
        authorId: fixture.memberId,
        body: "Bay 2 is still down.",
      },
    });
    await prisma.attachment.create({
      data: {
        organisation: { connect: { id: fixture.orgId } },
        comment: { connect: { id: comment.id } },
        uploadedBy: { connect: { id: fixture.memberId } },
        filename: "bay-2.jpg",
        contentType: "image/jpeg",
        bytes: 1024,
        storageKey: `${fixture.orgId}/bay-2.jpg`,
      },
    });
    return template;
  }

  it("says what a delete would cost before anybody is asked to accept it", async () => {
    const template = await withRecord("Check the simulator");
    const clean = await add("Typed in twice");

    const impacts = await deleteImpact(prisma, fixture.orgId, [template.id, clean.id]);
    const recorded = impacts.find((i) => i.id === template.id)!;

    expect(recorded).toMatchObject({ recorded: 2, comments: 1, attachments: 1, clean: false });
    expect(impacts.find((i) => i.id === clean.id)).toMatchObject({
      recorded: 0,
      comments: 0,
      clean: true,
    });
  });

  it("still refuses by default, and now says the override exists", async () => {
    const template = await withRecord("Check the simulator");

    await expect(deleteTemplate(prisma, fixture.orgId, template.id)).rejects.toThrow(
      /Delete anyway only if you accept/,
    );
    expect(await prisma.taskTemplate.findUnique({ where: { id: template.id } })).not.toBeNull();
  });

  it("deletes it when the risk is accepted, and takes the record with it", async () => {
    const template = await withRecord("Check the simulator");

    await deleteTemplate(prisma, fixture.orgId, template.id, { force: true });

    expect(await prisma.taskTemplate.findUnique({ where: { id: template.id } })).toBeNull();
    expect(await instancesFor(template.id)).toEqual([]);
    expect(await prisma.comment.count({ where: { instance: { templateId: template.id } } })).toBe(0);
  });

  it("clears the attachment objects out of the bucket", async () => {
    const template = await withRecord("Check the simulator");

    await deleteTemplate(prisma, fixture.orgId, template.id, { force: true });

    // The rows cascade away on their own; the objects behind them do not, and
    // an orphan in the bucket is a file nobody can reach and nobody can bill.
    expect(removed.keys).toEqual([`${fixture.orgId}/bay-2.jpg`]);
  });

  it("force does not reach into another organisation", async () => {
    const template = await withRecord("Check the simulator");
    const elsewhere = await prisma.organisation.create({
      data: { name: "Somebody Else Ltd", timezone: "Europe/London" },
    });

    await expect(
      deleteTemplate(prisma, elsewhere.id, template.id, { force: true }),
    ).rejects.toThrow(/not found/i);
    expect(await prisma.taskTemplate.findUnique({ where: { id: template.id } })).not.toBeNull();
  });
});

describeDb("deleting several tasks", () => {
  let fixture: Fixture;
  let clean: string;
  let recorded: string;

  beforeEach(async () => {
    fixture = await seedFixture();
    removed.keys = [];

    const a = await createTemplate(fixture, {
      title: "Typed in twice",
      startDate: addDays(TODAY, -30),
    });
    const b = await createTemplate(fixture, {
      title: "Clear the support inbox",
      startDate: addDays(TODAY, -30),
    });
    await generateInstances(prisma, addDays(TODAY, -30), addDays(TODAY, 14));
    const [first] = await instancesFor(b.id);
    await prisma.taskInstance.update({
      where: { id: first.id },
      data: { status: InstanceStatus.MISSED },
    });
    clean = a.id;
    recorded = b.id;
  });

  it("takes the ones with no record and reports the rest", async () => {
    const result = await deleteTemplates(prisma, fixture.orgId, [clean, recorded]);

    // Not all-or-nothing in either direction: refusing nineteen because one has
    // history helps nobody, and deleting the one because eighteen were clean
    // would be worse.
    expect(result.deleted).toBe(1);
    expect(result.blocked).toHaveLength(1);
    expect(result.blocked[0]).toMatchObject({ title: "Clear the support inbox", recorded: 1 });

    expect(await prisma.taskTemplate.findUnique({ where: { id: clean } })).toBeNull();
    expect(await prisma.taskTemplate.findUnique({ where: { id: recorded } })).not.toBeNull();
  });

  it("takes everything once the risk is accepted", async () => {
    const result = await deleteTemplates(prisma, fixture.orgId, [clean, recorded], {
      force: true,
    });

    expect(result).toMatchObject({ deleted: 2 });
    expect(result.blocked).toEqual([]);
    expect(await prisma.taskTemplate.count({ where: { organisationId: fixture.orgId } })).toBe(0);
  });

  it("ignores ids from another organisation even with force", async () => {
    const elsewhere = await prisma.organisation.create({
      data: { name: "Somebody Else Ltd", timezone: "Europe/London" },
    });
    const stranger = await prisma.taskTemplate.create({
      data: {
        organisationId: elsewhere.id,
        title: "Not yours",
        frequency: "DAILY",
        daysOfWeek: [1, 2, 3, 4, 5],
        startDate: new Date("2026-08-01"),
        assigneeId: fixture.adminId,
        createdById: fixture.adminId,
      },
    });

    const result = await deleteTemplates(prisma, fixture.orgId, [clean, stranger.id], {
      force: true,
    });

    expect(result.deleted).toBe(1);
    expect(await prisma.taskTemplate.findUnique({ where: { id: stranger.id } })).not.toBeNull();
  });
});
