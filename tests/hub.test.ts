/**
 * Evo Ops Hub, Phase 1: module access, sign-in rules, the task hook and the
 * activity log.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { Frequency, InstanceStatus, JobRunStatus, Role } from "@prisma/client";
import { canAccessModule, hubNavFor, sourceHref } from "@/lib/hub";
import { IDLE_LIMIT_MS, isAllowedGoogleProfile, sessionIsLive } from "@/lib/session-rules";
import { createTask } from "@/lib/create-task";
import { runJob } from "@/lib/job-runs";
import { runRegisteredJob, templatesMissingToday } from "@/lib/job-registry";
import { getMyDay } from "@/lib/my-day";
import { updateUser } from "@/lib/users";
import { createTemplate, databaseAvailable, prisma, seedFixture, type Fixture } from "./helpers/db";

const TODAY = "2026-10-08"; // a Thursday

describe("module access", () => {
  const member = { role: Role.MEMBER, moduleAccess: [] as string[] };
  const katy = { role: Role.MANAGER, moduleAccess: ["finance"] };
  const admin = { role: Role.ADMIN, moduleAccess: [] as string[] };

  it("keeps members out of granted-only modules", () => {
    expect(canAccessModule(member, "finance")).toBe(false);
    expect(canAccessModule(member, "activity")).toBe(false);
    expect(canAccessModule(member, "approvals")).toBe(true);
  });

  it("grants modules per person on top of the role", () => {
    expect(canAccessModule(katy, "finance")).toBe(true);
    expect(canAccessModule(katy, "email")).toBe(false);
  });

  it("gives admins every module", () => {
    expect(canAccessModule(admin, "finance")).toBe(true);
    expect(canAccessModule(admin, "activity")).toBe(true);
  });

  it("hides modules that aren't built yet, even from admins", () => {
    expect(hubNavFor(admin).map((m) => m.key)).toEqual(["approvals", "activity", "health"]);
    expect(hubNavFor(member).map((m) => m.key)).toEqual(["approvals"]);
    expect(hubNavFor({ role: Role.MANAGER, moduleAccess: ["activity"] }).map((m) => m.key)).toEqual([
      "approvals",
      "activity",
      "health",
    ]);
  });

  it("links a module-raised task back to its source", () => {
    expect(sourceHref({ sourceModule: "finance", sourceRef: "ap-1" })).toBe("/finance/ap-1");
    expect(sourceHref({ sourceModule: "email", sourceRef: "/email/flows/9" })).toBe("/email/flows/9");
    expect(sourceHref({ sourceModule: null, sourceRef: null })).toBeNull();
  });
});

describe("Google sign-in", () => {
  const ok = { email: "alex@evolutiongolf.co.uk", email_verified: true, hd: "evolutiongolf.co.uk" };

  it("allows verified Workspace accounts", () => {
    expect(isAllowedGoogleProfile(ok)).toBe(true);
    expect(isAllowedGoogleProfile({ ...ok, email: "Alex@EvolutionGolf.co.uk" })).toBe(true);
  });

  it("refuses anyone outside @evolutiongolf.co.uk", () => {
    expect(isAllowedGoogleProfile({ ...ok, email: "someone@gmail.com", hd: undefined })).toBe(false);
    expect(isAllowedGoogleProfile({ ...ok, email: "x@evolutiongolf.co.uk.evil.com", hd: "evil.com" })).toBe(false);
    // A personal Google account registered with a company address.
    expect(isAllowedGoogleProfile({ ...ok, hd: undefined })).toBe(false);
    expect(isAllowedGoogleProfile({ ...ok, email_verified: false })).toBe(false);
    expect(isAllowedGoogleProfile(null)).toBe(false);
  });
});

describe("session rules", () => {
  const now = new Date("2026-10-08T12:00:00Z");
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 60 * 60 * 1000);

  it("ends a session after 12 idle hours", () => {
    expect(sessionIsLive({ lastActiveAt: hoursAgo(11), sessionsRevokedAt: null }, hoursAgo(30).getTime(), now)).toBe(true);
    expect(sessionIsLive({ lastActiveAt: hoursAgo(13), sessionsRevokedAt: null }, hoursAgo(30).getTime(), now)).toBe(false);
    expect(IDLE_LIMIT_MS).toBe(12 * 60 * 60 * 1000);
  });

  it("starts the idle clock afresh on a new sign-in", () => {
    expect(sessionIsLive({ lastActiveAt: hoursAgo(48), sessionsRevokedAt: null }, hoursAgo(1).getTime(), now)).toBe(true);
  });

  it("lets through an old token for someone never seen, rather than guessing", () => {
    expect(sessionIsLive({ lastActiveAt: null, sessionsRevokedAt: null }, undefined, now)).toBe(true);
  });

  it("refuses sessions issued before a force sign-out", () => {
    const revoked = { lastActiveAt: hoursAgo(0), sessionsRevokedAt: hoursAgo(1) };
    expect(sessionIsLive(revoked, hoursAgo(2).getTime(), now)).toBe(false);
    expect(sessionIsLive(revoked, undefined, now)).toBe(false);
    expect(sessionIsLive(revoked, hoursAgo(0.5).getTime(), now)).toBe(true);
  });
});

const available = await databaseAvailable();
const describeDb = available ? describe : describe.skip;

describeDb("createTask (the task hook)", () => {
  let fixture: Fixture;
  beforeEach(async () => {
    fixture = await seedFixture();
  });

  const input = () => ({
    title: "Unknown supplier on INV-123",
    assigneeId: fixture.memberId,
    due: TODAY,
    sourceModule: "finance",
    sourceRef: "ap-exception-1",
  });

  it("lands on the assignee's day with its module and a link back", async () => {
    const { created } = await createTask(prisma, input(), TODAY);
    expect(created).toBe(true);

    const day = await getMyDay(prisma, { id: fixture.memberId, organisationId: fixture.orgId }, TODAY);
    const task = day.dueToday.find((t) => t.title === "Unknown supplier on INV-123");
    expect(task?.sourceModule).toBe("finance");
    expect(task?.sourceHref).toBe("/finance/ap-exception-1");
  });

  it("is a one-off owned by the assignee", async () => {
    const { template } = await createTask(prisma, input(), TODAY);
    expect(template.frequency).toBe(Frequency.ONE_OFF);
    expect(template.assigneeId).toBe(fixture.memberId);
  });

  it("returns the open task instead of adding a duplicate, even when raised at once", async () => {
    const [a, b] = await Promise.all([createTask(prisma, input(), TODAY), createTask(prisma, input(), TODAY)]);
    expect(a.template.id).toBe(b.template.id);
    await createTask(prisma, input(), TODAY);
    expect(await prisma.taskTemplate.count({ where: { sourceRef: "ap-exception-1" } })).toBe(1);
    expect(await prisma.taskInstance.count({ where: { template: { sourceRef: "ap-exception-1" } } })).toBe(1);
  });

  it("raises a fresh task once the earlier one is done", async () => {
    const first = await createTask(prisma, input(), TODAY);
    await prisma.taskInstance.updateMany({
      where: { templateId: first.template.id },
      data: { status: InstanceStatus.COMPLETED, completedAt: new Date() },
    });
    const second = await createTask(prisma, input(), TODAY);
    expect(second.created).toBe(true);
    expect(second.template.id).not.toBe(first.template.id);
  });

  it("puts a past due date on today, so the work still shows", async () => {
    const { template } = await createTask(prisma, { ...input(), due: "2026-10-01" }, TODAY);
    const [instance] = await prisma.taskInstance.findMany({ where: { templateId: template.id } });
    expect(instance.dueDate.toISOString().slice(0, 10)).toBe(TODAY);
  });

  it("refuses a deactivated assignee", async () => {
    await prisma.user.update({ where: { id: fixture.memberId }, data: { isActive: false } });
    await expect(createTask(prisma, input(), TODAY)).rejects.toThrow("deactivated");
  });
});

describeDb("activity log", () => {
  beforeEach(async () => {
    await seedFixture();
  });

  it("records a run's start, finish, status and outcome", async () => {
    await runJob(prisma, { module: "tasks", name: "test.ok", trigger: "test" }, async () => ({ message: "fine" }));
    await runJob(prisma, { module: "tasks", name: "test.warn", trigger: "test" }, async () => ({ warning: "looks off" }));
    await expect(
      runJob(prisma, { module: "tasks", name: "test.fail", trigger: "test" }, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const runs = await prisma.jobRun.findMany({ orderBy: { jobName: "asc" } });
    expect(runs.map((r) => [r.jobName, r.status, r.message])).toEqual([
      ["test.fail", JobRunStatus.FAILED, "boom"],
      ["test.ok", JobRunStatus.SUCCESS, "fine"],
      ["test.warn", JobRunStatus.WARNING, "looks off"],
    ]);
    expect(runs.every((r) => r.finishedAt && r.finishedAt >= r.startedAt)).toBe(true);
  });

  it("logs the nightly generate job through the registry", async () => {
    await runRegisteredJob(prisma, "tasks.generate", "manual");
    const [run] = await prisma.jobRun.findMany();
    expect(run).toMatchObject({ module: "tasks", jobName: "tasks.generate", trigger: "manual" });
    expect([JobRunStatus.SUCCESS, JobRunStatus.WARNING]).toContain(run.status);
  });

  it("refuses an unknown job", () => {
    expect(() => runRegisteredJob(prisma, "nope", "manual")).toThrow("Unknown job");
  });
});

describeDb("generate job's good-run check", () => {
  let fixture: Fixture;
  beforeEach(async () => {
    fixture = await seedFixture();
  });

  it("names an active template due today that has no task", async () => {
    const template = await createTemplate(fixture, { title: "Daily", frequency: Frequency.DAILY, startDate: "2026-10-01" });
    expect(await templatesMissingToday(prisma, TODAY)).toEqual([{ id: template.id, title: "Daily" }]);
  });

  it("is satisfied once today's task exists, and ignores templates not due today", async () => {
    const daily = await createTemplate(fixture, { frequency: Frequency.DAILY, startDate: "2026-10-01" });
    await createTemplate(fixture, { frequency: Frequency.WEEKLY, dayOfWeek: 1, startDate: "2026-10-01" });
    await prisma.taskInstance.create({
      data: {
        organisationId: fixture.orgId,
        templateId: daily.id,
        dueDate: new Date(`${TODAY}T00:00:00Z`),
        title: daily.title,
        assigneeId: daily.assigneeId,
      },
    });
    expect(await templatesMissingToday(prisma, TODAY)).toEqual([]);
  });
});

describeDb("people admin", () => {
  let fixture: Fixture;
  beforeEach(async () => {
    fixture = await seedFixture();
  });

  it("makes someone a manager with module access", async () => {
    const user = await updateUser(prisma, fixture.orgId, fixture.adminId, fixture.memberId, {
      role: Role.MANAGER,
      moduleAccess: ["finance", "finance"],
    });
    expect(user.role).toBe(Role.MANAGER);
    expect(user.moduleAccess).toEqual(["finance"]);
  });

  it("signs someone out everywhere, and on deactivation", async () => {
    const before = Date.now();
    const out = await updateUser(prisma, fixture.orgId, fixture.adminId, fixture.memberId, { signOutEverywhere: true });
    expect(out.sessionsRevokedAt!.getTime()).toBeGreaterThanOrEqual(before);

    const gone = await updateUser(prisma, fixture.orgId, fixture.adminId, fixture.otherMemberId, { isActive: false });
    expect(gone.sessionsRevokedAt).not.toBeNull();
  });

  it("won't let an admin force their own sign-out from here", async () => {
    await expect(
      updateUser(prisma, fixture.orgId, fixture.adminId, fixture.adminId, { signOutEverywhere: true }),
    ).rejects.toThrow();
  });
});
