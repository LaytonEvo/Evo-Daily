/**
 * The catch-up window.
 *
 * Shortening it is not a neutral edit: work that was catchable this morning
 * becomes a miss on somebody's record this afternoon, and every completion
 * rate in the app moves with it. So the sweep has to happen on save — leaving
 * it to the nightly cron would make the setting look broken for a day — and it
 * has to stop exactly where the new window does.
 */

import { InstanceStatus } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createTemplate,
  databaseAvailable,
  instancesFor,
  prisma,
  seedFixture,
  type Fixture,
} from "./helpers/db";
import { generateInstances } from "@/lib/recurrence";
import { getSettings, settingsInputSchema, updateSettings } from "@/lib/settings";
import { addDays, toDateOnly } from "@/lib/time";

const available = await databaseAvailable();
const describeDb = available ? describe : describe.skip;

const TODAY = "2026-09-23"; // Wednesday

describe("settingsInputSchema", () => {
  it("accepts a same-day window and refuses a negative one", () => {
    expect(settingsInputSchema.safeParse({ graceDays: 0 }).success).toBe(true);
    expect(settingsInputSchema.safeParse({ graceDays: -1 }).success).toBe(false);
  });

  it("refuses a window so long the completion rate stops meaning anything", () => {
    expect(settingsInputSchema.safeParse({ graceDays: 30 }).success).toBe(true);
    expect(settingsInputSchema.safeParse({ graceDays: 31 }).success).toBe(false);
    expect(settingsInputSchema.safeParse({ graceDays: 1.5 }).success).toBe(false);
  });
});

describeDb("updating the catch-up window", () => {
  let fixture: Fixture;
  let templateId: string;

  beforeEach(async () => {
    fixture = await seedFixture({ graceDays: 5 });
    const template = await createTemplate(fixture, {
      title: "Record range ball stock level",
      startDate: addDays(TODAY, -10),
      assigneeId: fixture.memberId,
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    });
    await generateInstances(prisma, addDays(TODAY, -10), TODAY);
    templateId = template.id;
  });

  const openOn = async (date: string) =>
    (await instancesFor(templateId)).find(
      (i) => toDateOnly(i.dueDate) === date && i.status === InstanceStatus.PENDING,
    );

  it("writes off everything outside the new window straight away", async () => {
    // Inside a five-day window, four days ago is still catchable.
    expect(await openOn(addDays(TODAY, -4))).toBeDefined();

    const result = await updateSettings(prisma, fixture.orgId, { graceDays: 1 }, TODAY);

    expect(result.graceDays).toBe(1);
    expect(result.swept).toBeGreaterThan(0);
    expect(await openOn(addDays(TODAY, -4))).toBeUndefined();
  });

  it("stops exactly at the edge of the new window", async () => {
    await updateSettings(prisma, fixture.orgId, { graceDays: 1 }, TODAY);

    // One day is the window, so yesterday and today stay catchable and the
    // day before yesterday does not.
    expect(await openOn(TODAY)).toBeDefined();
    expect(await openOn(addDays(TODAY, -1))).toBeDefined();
    expect(await openOn(addDays(TODAY, -2))).toBeUndefined();
  });

  it("leaves completed days alone", async () => {
    const rows = await instancesFor(templateId);
    const old = rows.find((i) => toDateOnly(i.dueDate) === addDays(TODAY, -6))!;
    await prisma.taskInstance.update({
      where: { id: old.id },
      data: { status: InstanceStatus.COMPLETED, completedAt: new Date() },
    });

    await updateSettings(prisma, fixture.orgId, { graceDays: 1 }, TODAY);

    const after = await prisma.taskInstance.findUniqueOrThrow({ where: { id: old.id } });
    expect(after.status).toBe(InstanceStatus.COMPLETED);
  });

  it("lengthening it sweeps nothing and reopens nothing", async () => {
    // A task already written off stays written off: the record does not
    // un-happen because somebody moved a setting.
    await updateSettings(prisma, fixture.orgId, { graceDays: 1 }, TODAY);
    const missedBefore = (await instancesFor(templateId)).filter(
      (i) => i.status === InstanceStatus.MISSED,
    ).length;

    const result = await updateSettings(prisma, fixture.orgId, { graceDays: 14 }, TODAY);

    expect(result.swept).toBe(0);
    const missedAfter = (await instancesFor(templateId)).filter(
      (i) => i.status === InstanceStatus.MISSED,
    ).length;
    expect(missedAfter).toBe(missedBefore);
  });

  it("does not write off another organisation's work", async () => {
    const elsewhere = await prisma.organisation.create({
      data: { name: "Somebody Else Ltd", timezone: "Europe/London" },
    });
    await prisma.settings.create({ data: { organisationId: elsewhere.id, graceDays: 14 } });
    const stranger = await prisma.user.create({
      data: {
        organisationId: elsewhere.id,
        email: "stranger@elsewhere.local",
        name: "Stranger",
        passwordHash: "x",
        mustChangePassword: false,
      },
    });
    const theirTemplate = await prisma.taskTemplate.create({
      data: {
        organisationId: elsewhere.id,
        title: "Not yours",
        frequency: "DAILY",
        daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
        startDate: new Date(addDays(TODAY, -10)),
        assigneeId: stranger.id,
        createdById: stranger.id,
      },
    });
    // Old enough to be swept by a one-day window, and well inside theirs.
    const theirs = await prisma.taskInstance.create({
      data: {
        organisationId: elsewhere.id,
        templateId: theirTemplate.id,
        assigneeId: stranger.id,
        title: "Not yours",
        dueDate: new Date(addDays(TODAY, -6)),
        dueAt: new Date(`${addDays(TODAY, -6)}T23:59:00Z`),
      },
    });

    await updateSettings(prisma, fixture.orgId, { graceDays: 1 }, TODAY);

    expect((await getSettings(prisma, elsewhere.id)).graceDays).toBe(14);
    const after = await prisma.taskInstance.findUniqueOrThrow({ where: { id: theirs.id } });
    expect(after.status).toBe(InstanceStatus.PENDING);
  });
});
