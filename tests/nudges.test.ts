import { InstanceStatus, Role } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { createTemplate, databaseAvailable, prisma, seedFixture, type Fixture } from "./helpers/db";
import { generateInstances, sweepMissed } from "@/lib/recurrence";
import { completeInstance } from "@/lib/instances";
import {
  afternoonNudge,
  managerDigest,
  missAlerts,
  morningBrief,
  MISS_ALERT_THRESHOLD,
} from "@/lib/nudges";
import { slackEnabled } from "@/lib/slack";
import { addDays } from "@/lib/time";

const available = await databaseAvailable();
const describeDb = available ? describe : describe.skip;

const TODAY = "2026-08-27";

describe("Slack gating", () => {
  it("is off unless a bot token is configured", () => {
    // The app must run fully without Slack, so this is the default state.
    expect(slackEnabled()).toBe(Boolean(process.env.SLACK_BOT_TOKEN));
  });
});

describeDb("nudges", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await seedFixture();
    await prisma.user.update({
      where: { id: fixture.memberId },
      data: { slackUserId: "U_ALEX", managerId: fixture.adminId },
    });
    await prisma.user.update({
      where: { id: fixture.adminId },
      data: { slackUserId: "U_ADA" },
    });
  });

  const admin = () => ({
    id: fixture.adminId,
    role: Role.ADMIN,
    organisationId: fixture.orgId,
  });

  it("reports itself skipped rather than failing when Slack is off", async () => {
    const result = await morningBrief(prisma, { today: TODAY });
    if (!slackEnabled()) {
      expect(result.skipped).toBe("slack_not_configured");
      expect(result.sent).toBe(0);
    }
  });

  it("briefs each member on what they owe today, overdue included", async () => {
    await createTemplate(fixture, {
      title: "Clear the inbox",
      startDate: addDays(TODAY, -1),
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
      dueTime: "10:00",
    });
    await generateInstances(prisma, addDays(TODAY, -1), TODAY);

    const result = await morningBrief(prisma, { today: TODAY, dryRun: true });

    expect(result.messages).toHaveLength(1);
    const message = result.messages![0];
    expect(message.to).toBe("U_ALEX");
    expect(message.text).toContain("2 tasks today");
    expect(message.text).toContain("Clear the inbox (by 10:00)");
    expect(message.text).toContain("overdue from");
  });

  it("says nothing to someone with a clear day", async () => {
    await createTemplate(fixture, { startDate: TODAY, daysOfWeek: [1, 2, 3, 4, 5, 6, 7] });
    await generateInstances(prisma, TODAY, TODAY);

    const instance = await prisma.taskInstance.findFirstOrThrow({});
    await completeInstance(prisma, instance.id, admin());

    const result = await morningBrief(prisma, { today: TODAY, dryRun: true });
    expect(result.messages).toHaveLength(0);
  });

  it("nudges only the people with something still open", async () => {
    await createTemplate(fixture, {
      startDate: TODAY,
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
      assigneeId: fixture.memberId,
    });
    await createTemplate(fixture, {
      title: "Brad's task",
      startDate: TODAY,
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
      assigneeId: fixture.otherMemberId,
    });
    await generateInstances(prisma, TODAY, TODAY);

    const result = await afternoonNudge(prisma, { today: TODAY, dryRun: true });

    // Brad has an open task too, but no Slack ID, so there is nobody to nudge.
    expect(result.messages).toHaveLength(1);
    expect(result.messages![0].to).toBe("U_ALEX");
    expect(result.messages![0].text).toContain("1 task still open today");
  });

  it("posts last week's numbers, leaderboard and problem tasks to the manager channel", async () => {
    await createTemplate(fixture, {
      title: "Weekly slipper",
      startDate: addDays(TODAY, -14),
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    });
    await generateInstances(prisma, addDays(TODAY, -14), TODAY);
    await sweepMissed(prisma, TODAY, 2);

    const result = await managerDigest(prisma, { today: TODAY, dryRun: true });

    expect(result.messages).toHaveLength(1);
    const text = result.messages![0].text;
    expect(text).toContain("Test Org — week to");
    expect(text).toContain("Completion 0%");
    expect(text).toContain("*Leaderboard*");
    expect(text).toContain("*Problem tasks*");
    expect(text).toContain("Weekly slipper");
  });

  it("alerts a manager once someone hits three misses in a rolling week", async () => {
    await createTemplate(fixture, {
      startDate: addDays(TODAY, -6),
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    });
    await generateInstances(prisma, addDays(TODAY, -6), addDays(TODAY, -3));
    await sweepMissed(prisma, TODAY, 2);

    const missed = await prisma.taskInstance.count({
      where: { status: InstanceStatus.MISSED },
    });
    expect(missed).toBeGreaterThanOrEqual(MISS_ALERT_THRESHOLD);

    const result = await missAlerts(prisma, { today: TODAY, dryRun: true });

    expect(result.messages).toHaveLength(1);
    expect(result.messages![0].to).toBe("U_ADA"); // the manager, not the member
    expect(result.messages![0].text).toContain("Alex Member has missed");
  });

  it("stays quiet below the threshold", async () => {
    await createTemplate(fixture, {
      startDate: addDays(TODAY, -4),
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    });
    await generateInstances(prisma, addDays(TODAY, -4), addDays(TODAY, -3));
    await sweepMissed(prisma, TODAY, 2);

    const result = await missAlerts(prisma, { today: TODAY, dryRun: true });
    expect(result.messages ?? []).toHaveLength(0);
  });

  it("escapes Slack markup in a task title", async () => {
    await createTemplate(fixture, {
      title: "Check <stock> & pricing",
      startDate: TODAY,
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    });
    await generateInstances(prisma, TODAY, TODAY);

    const result = await morningBrief(prisma, { today: TODAY, dryRun: true });
    expect(result.messages![0].text).toContain("Check &lt;stock&gt; &amp; pricing");
  });
});
