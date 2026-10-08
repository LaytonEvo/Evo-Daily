/**
 * Evo Ops Hub, Phase 2: approvals, integrations, incidents, monitoring,
 * kill switches. Includes the phase gate: a test approval and a test
 * module-raised task, end to end.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalStatus, IntegrationStatus, JobRunStatus, Role } from "@prisma/client";

// The services import the app's prisma client; point it at the test database.
vi.mock("@/lib/db", async () => ({ prisma: (await import("./helpers/db")).prisma }));

const { requestApproval, decideApproval, retryExecution, expireApprovals, pendingCounts, canDecide } = await import(
  "@/lib/approvals"
);
const { registerApprovalHandler } = await import("@/lib/approval-handlers");
const { setAutomation, automationEnabled, hubOwnerId, setSetting } = await import("@/lib/hub-settings");
const { classify, recordIntegrationCall } = await import("@/lib/integrations");
const { openIncident, resolveIncident } = await import("@/lib/incidents");
const { runMonitor, housekeeping } = await import("@/lib/monitor");
const { jobLight, moduleLight, worst } = await import("@/lib/health");
const { runRegisteredJob } = await import("@/lib/job-registry");
const { buildAdminDigest } = await import("@/lib/hub-digest");
const { getMyDay } = await import("@/lib/my-day");
const { createTask } = await import("@/lib/create-task");
const { databaseAvailable, prisma, seedFixture } = await import("./helpers/db");
type Fixture = Awaited<ReturnType<typeof seedFixture>>;

const TODAY = "2026-10-08";

describe("health lights", () => {
  it("is red for a failure or an open incident, amber for a warning or nothing yet", () => {
    expect(jobLight({ status: JobRunStatus.SUCCESS }, [], "a")).toBe("green");
    expect(jobLight({ status: JobRunStatus.WARNING }, [], "a")).toBe("amber");
    expect(jobLight({ status: JobRunStatus.FAILED }, [], "a")).toBe("red");
    expect(jobLight(null, [], "a")).toBe("amber");
    expect(jobLight({ status: JobRunStatus.SUCCESS }, [{ key: "job-missed:a" }], "a")).toBe("red");
  });
  it("shows a paused module as amber at best", () => {
    expect(moduleLight(["green", "green"], false)).toBe("amber");
    expect(moduleLight(["green", "red"], false)).toBe("red");
    expect(worst(["green", "amber", "green"])).toBe("amber");
  });
});

describe("integration status", () => {
  it("treats auth failures as down, throttling and network trouble as degraded", () => {
    expect(classify({ ok: true })).toBe(IntegrationStatus.OK);
    expect(classify({ ok: false, error: "invalid_auth" })).toBe(IntegrationStatus.DOWN);
    expect(classify({ ok: false, error: "token_revoked" })).toBe(IntegrationStatus.DOWN);
    expect(classify({ ok: false, error: "ratelimited" })).toBe(IntegrationStatus.DEGRADED);
    expect(classify({ ok: false, error: "fetch failed" })).toBe(IntegrationStatus.DEGRADED);
  });
  it("doesn't blame the connection for one bad request, or count an unconfigured client", () => {
    expect(classify({ ok: false, error: "channel_not_found" })).toBe(IntegrationStatus.OK);
    expect(classify({ ok: false, error: "slack_not_configured" })).toBeNull();
  });
});

describe("who may decide", () => {
  const a = { assigneeId: "alex", module: "finance" };
  it("lets admins, the assignee and managers of the module decide", () => {
    expect(canDecide({ id: "x", role: Role.ADMIN, moduleAccess: [] }, a)).toBe(true);
    expect(canDecide({ id: "alex", role: Role.MEMBER, moduleAccess: [] }, a)).toBe(true);
    expect(canDecide({ id: "katy", role: Role.MANAGER, moduleAccess: ["finance"] }, a)).toBe(true);
  });
  it("keeps everyone else out", () => {
    expect(canDecide({ id: "brad", role: Role.MEMBER, moduleAccess: ["finance"] }, a)).toBe(false);
    expect(canDecide({ id: "katy", role: Role.MANAGER, moduleAccess: ["email"] }, a)).toBe(false);
  });
});

const available = await databaseAvailable();
const describeDb = available ? describe : describe.skip;

async function people(fixture: Fixture) {
  const [admin, member, other] = await Promise.all(
    [fixture.adminId, fixture.memberId, fixture.otherMemberId].map((id) => prisma.user.findUniqueOrThrow({ where: { id } })),
  );
  return { admin, member, other };
}

function testApproval(fixture: Fixture, extra: Record<string, unknown> = {}) {
  return requestApproval(prisma, {
    organisationId: fixture.orgId,
    module: "hub",
    itemType: "test",
    title: "Test approval",
    summary: "Harmless",
    payload: { message: "original" },
    assigneeId: fixture.memberId,
    requestedById: fixture.adminId,
    ...extra,
  });
}

describeDb("approvals", () => {
  let fixture: Fixture;
  beforeEach(async () => {
    fixture = await seedFixture();
  });

  it("refuses an item type nothing can carry out", async () => {
    await expect(
      requestApproval(prisma, { module: "finance", itemType: "nope", title: "x", summary: "x" }),
    ).rejects.toThrow("No handler");
  });

  it("returns the pending approval when the same item is raised again", async () => {
    const [a, b] = await Promise.all([
      testApproval(fixture, { sourceRef: "item-1" }),
      testApproval(fixture, { sourceRef: "item-1" }),
    ]);
    expect(a.approval.id).toBe(b.approval.id);
    expect(await prisma.approval.count()).toBe(1);
  });

  it("carries out the action exactly once, however many times approve is pressed", async () => {
    const { member } = await people(fixture);
    const { approval } = await testApproval(fixture);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => decideApproval(prisma, member, approval.id, { decision: "approve" })),
    );
    expect(results.filter((r) => !r.alreadyDecided)).toHaveLength(1);
    expect(await prisma.jobRun.count({ where: { jobName: "hub.test-approval" } })).toBe(1);
    const done = await prisma.approval.findUniqueOrThrow({ where: { id: approval.id } });
    expect(done).toMatchObject({ status: ApprovalStatus.APPROVED, executionStatus: "success", decidedById: member.id });
  });

  it("carries out the edited version when edited before approving", async () => {
    const { member } = await people(fixture);
    const { approval } = await testApproval(fixture);
    await decideApproval(prisma, member, approval.id, { decision: "approve", edits: { message: "edited" } });
    const run = await prisma.jobRun.findFirstOrThrow({ where: { jobName: "hub.test-approval" } });
    expect((run.details as { message: string }).message).toBe("edited");
  });

  it("won't let a field be edited that the module didn't offer", async () => {
    const { member } = await people(fixture);
    const { approval } = await testApproval(fixture);
    await expect(
      decideApproval(prisma, member, approval.id, { decision: "approve", edits: { amount: "1000000" } }),
    ).rejects.toThrow("can't be edited");
  });

  it("records the note and raises a rework task for whoever asked", async () => {
    const { member } = await people(fixture);
    const { approval } = await testApproval(fixture);
    await decideApproval(prisma, member, approval.id, { decision: "reject", note: "Wrong tone", rework: true });
    const rejected = await prisma.approval.findUniqueOrThrow({ where: { id: approval.id } });
    expect(rejected).toMatchObject({ status: ApprovalStatus.REJECTED, decisionNote: "Wrong tone", needsRework: true });
    expect(rejected.executedAt).toBeNull();

    const day = await getMyDay(prisma, { id: fixture.adminId, organisationId: fixture.orgId }, TODAY);
    const task = [...day.dueToday, ...day.overdue].find((t) => t.title === "Rework: Test approval");
    expect(task?.sourceHref).toBe(`/approvals/${approval.id}`);
  });

  it("rejects without a task when rework isn't asked for", async () => {
    const { member } = await people(fixture);
    const { approval } = await testApproval(fixture);
    await decideApproval(prisma, member, approval.id, { decision: "reject" });
    expect(await prisma.taskTemplate.count({ where: { title: { startsWith: "Rework" } } })).toBe(0);
  });

  it("keeps someone else's approval from a member", async () => {
    const { other } = await people(fixture);
    const { approval } = await testApproval(fixture);
    await expect(decideApproval(prisma, other, approval.id, { decision: "approve" })).rejects.toThrow("isn't yours");
  });

  it("can't approve while the module's automation is paused, but can still reject", async () => {
    const { admin, member } = await people(fixture);
    await setAutomation(prisma, "hub", false, { userId: admin.id, reason: "testing" });
    const { approval } = await testApproval(fixture);
    await expect(decideApproval(prisma, member, approval.id, { decision: "approve" })).rejects.toThrow("paused");
    const r = await decideApproval(prisma, member, approval.id, { decision: "reject" });
    expect(r.approval.status).toBe(ApprovalStatus.REJECTED);
  });

  it("expires what nobody decided in time", async () => {
    const { member } = await people(fixture);
    const { approval } = await testApproval(fixture, { expiresAt: new Date(Date.now() - 1000) });
    const r = await decideApproval(prisma, member, approval.id, { decision: "approve" });
    expect(r.alreadyDecided).toBe(true);
    expect(await expireApprovals(prisma)).toBe(1);
    expect((await prisma.approval.findUniqueOrThrow({ where: { id: approval.id } })).status).toBe(ApprovalStatus.EXPIRED);
  });

  it("records a failed action and runs it again only on retry", async () => {
    const { member } = await people(fixture);
    let calls = 0;
    registerApprovalHandler("hub", "flaky", {
      label: "Flaky",
      onApprove: async () => {
        calls += 1;
        if (calls === 1) throw new Error("outside system said no");
        return { ok: true };
      },
    });
    const { approval } = await testApproval(fixture, { itemType: "flaky" });
    await decideApproval(prisma, member, approval.id, { decision: "approve" });
    expect((await prisma.approval.findUniqueOrThrow({ where: { id: approval.id } })).executionStatus).toBe("failed");

    const [a, b] = await Promise.all([
      retryExecution(prisma, member, approval.id),
      retryExecution(prisma, member, approval.id),
    ]);
    expect([a.executionStatus, b.executionStatus]).toContain("success");
    expect(calls).toBe(2);
  });

  it("counts what's waiting and what has waited over 48 hours", async () => {
    const { member } = await people(fixture);
    const { approval } = await testApproval(fixture);
    await testApproval(fixture);
    await prisma.approval.update({ where: { id: approval.id }, data: { createdAt: new Date(Date.now() - 49 * 3600_000) } });
    expect(await pendingCounts(prisma, member)).toEqual({ total: 2, stale: 1 });
  });
});

describeDb("the Phase 2 gate", () => {
  let fixture: Fixture;
  beforeEach(async () => {
    fixture = await seedFixture();
  });

  it("a test approval goes from raised to carried out, and is logged", async () => {
    const { admin } = await people(fixture);
    const { approval } = await requestApproval(prisma, {
      organisationId: fixture.orgId,
      module: "hub",
      itemType: "test",
      title: "Gate approval",
      summary: "Harmless",
      payload: { message: "hello" },
      assigneeId: admin.id,
      requestedById: admin.id,
    });
    expect(await pendingCounts(prisma, admin)).toMatchObject({ total: 1 });
    await decideApproval(prisma, admin, approval.id, { decision: "approve" });
    expect(await pendingCounts(prisma, admin)).toMatchObject({ total: 0 });
    const runs = await prisma.jobRun.findMany({ where: { module: "hub" } });
    expect(runs.map((r) => r.jobName).sort()).toEqual(["approval.test", "hub.test-approval"]);
    expect(runs.every((r) => r.status === JobRunStatus.SUCCESS)).toBe(true);
  });

  it("a test module-raised task lands on the day with its badge and link", async () => {
    await createTask(
      prisma,
      { title: "Gate task", assigneeId: fixture.adminId, due: TODAY, sourceModule: "hub", sourceRef: "/admin/health#test" },
      TODAY,
    );
    const day = await getMyDay(prisma, { id: fixture.adminId, organisationId: fixture.orgId }, TODAY);
    expect(day.dueToday.find((t) => t.title === "Gate task")).toMatchObject({
      sourceModule: "hub",
      sourceHref: "/admin/health#test",
    });
  });
});

describeDb("kill switches and the hub owner", () => {
  let fixture: Fixture;
  beforeEach(async () => {
    fixture = await seedFixture();
  });

  it("pauses one module, or everything, and keeps who and why", async () => {
    expect(await automationEnabled(prisma, "tasks")).toBe(true);
    await setAutomation(prisma, "tasks", false, { userId: fixture.adminId, reason: "Slack spam" });
    expect(await automationEnabled(prisma, "tasks")).toBe(false);
    expect(await automationEnabled(prisma, "finance")).toBe(true);
    await setAutomation(prisma, "global", false, { userId: fixture.adminId });
    expect(await automationEnabled(prisma, "finance")).toBe(false);
    const changes = await prisma.hubSettingChange.findMany({ orderBy: { at: "asc" } });
    expect(changes[0]).toMatchObject({ key: "automation.tasks", reason: "Slack spam", userId: fixture.adminId });
  });

  it("skips the Slack nudges while Tasks automation is paused", async () => {
    await setAutomation(prisma, "tasks", false, { userId: fixture.adminId });
    const outcome = await runRegisteredJob(prisma, "nudge.morning-brief", "test");
    expect(outcome.message).toMatch(/paused/);
  });

  it("falls back to the first admin as hub owner until one is set", async () => {
    expect(await hubOwnerId(prisma)).toBe(fixture.adminId);
    await setSetting(prisma, "hub.ownerId", fixture.memberId, { userId: fixture.adminId });
    expect(await hubOwnerId(prisma)).toBe(fixture.memberId);
  });
});

describeDb("incidents and monitoring", () => {
  let fixture: Fixture;
  beforeEach(async () => {
    fixture = await seedFixture();
  });

  it("opens one incident per problem and closes it once", async () => {
    expect((await openIncident(prisma, { key: "k", title: "Broken" })).opened).toBe(true);
    expect((await openIncident(prisma, { key: "k", title: "Broken" })).opened).toBe(false);
    expect(await prisma.incident.count()).toBe(1);
    expect((await resolveIncident(prisma, "k")).resolved).toBe(true);
    expect((await resolveIncident(prisma, "k")).resolved).toBe(false);
    expect((await openIncident(prisma, { key: "k", title: "Broken again" })).opened).toBe(true);
    expect(await prisma.incident.count()).toBe(2);
  });

  const run = (jobName: string, status: JobRunStatus, hoursAgo: number) =>
    prisma.jobRun.create({
      data: { module: "tasks", jobName, trigger: "schedule", status, startedAt: new Date(Date.now() - hoursAgo * 3600_000) },
    });

  it("leaves a single failure to the retry, but alerts and raises a task on the second", async () => {
    const jobs = [{ name: "x", expectedEveryHours: null }];
    await run("x", JobRunStatus.FAILED, 1);
    await runMonitor(prisma, jobs);
    expect(await prisma.incident.count()).toBe(0);

    await run("x", JobRunStatus.FAILED, 0.5);
    await runMonitor(prisma, jobs);
    await runMonitor(prisma, jobs);
    expect(await prisma.incident.count({ where: { openKey: "job-failing:x" } })).toBe(1);
    expect(await prisma.taskTemplate.count({ where: { title: "Fix failing job: x", assigneeId: fixture.adminId } })).toBe(1);

    await run("x", JobRunStatus.SUCCESS, 0);
    await runMonitor(prisma, jobs);
    expect(await prisma.incident.count({ where: { openKey: { not: null } } })).toBe(0);
  });

  it("flags a job that missed its window, and not one the log is too young to judge", async () => {
    const jobs = [
      { name: "daily", expectedEveryHours: 26 },
      { name: "never-seen", expectedEveryHours: 26 },
    ];
    await run("daily", JobRunStatus.SUCCESS, 2);
    await runMonitor(prisma, jobs);
    expect(await prisma.incident.count()).toBe(0);

    await prisma.jobRun.updateMany({ data: { startedAt: new Date(Date.now() - 30 * 3600_000) } });
    await runMonitor(prisma, jobs);
    const keys = (await prisma.incident.findMany()).map((i) => i.key).sort();
    expect(keys).toEqual(["job-missed:daily", "job-missed:never-seen"]);
  });

  it("raises a task when a job warns three runs running", async () => {
    for (const h of [3, 2, 1]) await run("w", JobRunStatus.WARNING, h);
    await runMonitor(prisma, [{ name: "w", expectedEveryHours: null }]);
    expect(await prisma.taskTemplate.count({ where: { title: "Look into repeated warnings: w" } })).toBe(1);
  });

  it("opens an incident when a connection goes down, and closes it on recovery", async () => {
    await recordIntegrationCall(prisma, "slack", { ok: false, error: "token_revoked" });
    await runMonitor(prisma, []);
    expect(await prisma.incident.count({ where: { openKey: "integration:slack" } })).toBe(1);
    await recordIntegrationCall(prisma, "slack", { ok: true });
    await runMonitor(prisma, []);
    expect(await prisma.incident.count({ where: { openKey: { not: null } } })).toBe(0);
  });

  it("asks for a connection to be renewed a week before its token expires", async () => {
    await prisma.integration.create({
      data: { name: "xero", tokenExpiresAt: new Date(Date.now() + 3 * 24 * 3600_000) },
    });
    await runMonitor(prisma, []);
    expect(await prisma.taskTemplate.count({ where: { title: "Renew the xero connection" } })).toBe(1);
  });

  it("clears history past its retention period and keeps the rest", async () => {
    await run("old", JobRunStatus.SUCCESS, 24 * 400);
    await run("new", JobRunStatus.SUCCESS, 1);
    const removed = await housekeeping(prisma);
    expect(removed.runs).toBe(1);
    expect(await prisma.jobRun.count()).toBe(1);
  });

  it("puts failures, warnings and stale approvals in the admin digest", async () => {
    await run("bad", JobRunStatus.FAILED, 1);
    await prisma.jobRun.create({ data: { module: "tasks", jobName: "meh", trigger: "schedule", status: JobRunStatus.WARNING, message: "count mismatch" } });
    const { text, issues } = await buildAdminDigest(prisma);
    expect(issues).toBeGreaterThanOrEqual(2);
    expect(text).toMatch(/1 failed run\(s\): bad/);
    expect(text).toMatch(/count mismatch/);
  });

  it("runs the monitor through the registry, logged like any job", async () => {
    await runRegisteredJob(prisma, "hub.monitor", "test");
    expect(await prisma.jobRun.count({ where: { jobName: "hub.monitor", status: JobRunStatus.SUCCESS } })).toBe(1);
    expect(await prisma.jobRun.count({ where: { jobName: "hub.housekeeping" } })).toBe(1);
  });
});
