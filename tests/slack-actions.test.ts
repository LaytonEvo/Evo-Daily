import { beforeEach, describe, expect, it, vi } from "vitest";
import { InstanceStatus } from "@prisma/client";
import {
  createTemplate,
  databaseAvailable,
  instancesFor,
  prisma,
  seedFixture,
  type Fixture,
} from "./helpers/db";
import { generateInstances } from "@/lib/recurrence";
import type { Intent } from "@/lib/claude";

// Claude is stubbed: these tests are about what the app does with an intent,
// including intents a model should never have produced.
const intent = vi.hoisted(() => ({ value: null as Intent | null }));
vi.mock("@/lib/claude", () => ({
  claudeEnabled: () => true,
  readIntent: async () => intent.value,
}));
vi.mock("@/lib/db", async () => ({ prisma: (await import("./helpers/db")).prisma }));

const { handleMessage, completeFromButton, personForSlackUser } = await import(
  "@/lib/slack-actions"
);

const available = await databaseAvailable();
const describeDb = available ? describe : describe.skip;

const TODAY = "2026-09-01";

describeDb("slack actions", () => {
  let fixture: Fixture;
  let mine: string;
  let theirs: string;

  beforeEach(async () => {
    fixture = await seedFixture();
    await prisma.user.update({
      where: { id: fixture.memberId },
      data: { slackUserId: "U_ALEX" },
    });
    await prisma.user.update({
      where: { id: fixture.otherMemberId },
      data: { slackUserId: "U_BRAD" },
    });

    const mineTemplate = await createTemplate(fixture, {
      title: "Record range ball stock level",
      startDate: TODAY,
      assigneeId: fixture.memberId,
    });
    const theirsTemplate = await createTemplate(fixture, {
      title: "Pick and pack web orders",
      startDate: TODAY,
      assigneeId: fixture.otherMemberId,
    });
    await generateInstances(prisma, TODAY, TODAY);

    mine = (await instancesFor(mineTemplate.id))[0].id;
    theirs = (await instancesFor(theirsTemplate.id))[0].id;
    intent.value = null;
  });

  it("does not recognise an unmapped Slack account", async () => {
    expect(await personForSlackUser(prisma, "U_NOBODY")).toBeNull();
  });

  it("does not act for a deactivated account", async () => {
    // Their Slack id still exists; the account behind it does not.
    await prisma.user.update({ where: { id: fixture.memberId }, data: { isActive: false } });
    const reply = await completeFromButton(prisma, "U_ALEX", mine);

    expect(reply.text).toMatch(/do not recognise/i);
    const after = await prisma.taskInstance.findUnique({ where: { id: mine } });
    expect(after?.status).toBe(InstanceStatus.PENDING);
  });

  it("completes the task behind a button tap", async () => {
    const reply = await completeFromButton(prisma, "U_ALEX", mine);

    expect(reply.text).toContain("Record range ball stock level");
    const after = await prisma.taskInstance.findUnique({ where: { id: mine } });
    expect(after?.status).toBe(InstanceStatus.COMPLETED);
    expect(after?.completedById).toBe(fixture.memberId);
  });

  it("refuses a button tap carrying someone else's instance id", async () => {
    // The value is attacker-controllable: a signed request can be re-sent with
    // a swapped id, so the id alone must never be enough.
    const reply = await completeFromButton(prisma, "U_ALEX", theirs);

    expect(reply.text).toMatch(/not found/i);
    const after = await prisma.taskInstance.findUnique({ where: { id: theirs } });
    expect(after?.status).toBe(InstanceStatus.PENDING);
  });

  it("completes from a typed message and keeps the note", async () => {
    intent.value = { kind: "complete", instanceId: mine, note: "ran out of range balls" };
    const reply = await handleMessage(prisma, "U_ALEX", "done the stock take, ran out");

    expect(reply.text).toContain("ran out of range balls");
    const after = await prisma.taskInstance.findUnique({ where: { id: mine } });
    expect(after?.status).toBe(InstanceStatus.COMPLETED);
    expect(after?.note).toBe("ran out of range balls");
  });

  it("refuses a typed completion naming another person's task", async () => {
    // Even if the model returns an id it should never have seen.
    intent.value = { kind: "complete", instanceId: theirs, note: null };
    const reply = await handleMessage(prisma, "U_ALEX", "done the picking");

    expect(reply.text).toMatch(/not found/i);
    const after = await prisma.taskInstance.findUnique({ where: { id: theirs } });
    expect(after?.status).toBe(InstanceStatus.PENDING);
  });

  it("lists what is open", async () => {
    intent.value = { kind: "list" };
    const reply = await handleMessage(prisma, "U_ALEX", "what do I owe");

    expect(reply.text).toContain("Record range ball stock level");
    expect(reply.text).not.toContain("Pick and pack web orders");
  });

  it("describes a new task without creating one", async () => {
    // A schedule guessed from a sentence would generate wrong work every day,
    // so this deliberately stops at the description.
    intent.value = {
      kind: "create",
      title: "Check the ball machine",
      assignee: "Alex",
      schedule: "every weekday",
    };
    const before = await prisma.taskTemplate.count();
    const reply = await handleMessage(prisma, "U_ALEX", "add a daily ball machine check for Alex");

    expect(reply.text).toContain("Check the ball machine");
    expect(reply.text).toMatch(/have not created it/i);
    expect(await prisma.taskTemplate.count()).toBe(before);
  });

  it("passes an unclear reply straight back", async () => {
    intent.value = { kind: "unclear", reply: "Which task do you mean?" };
    const reply = await handleMessage(prisma, "U_ALEX", "yep sorted");
    expect(reply.text).toBe("Which task do you mean?");
  });
});
