/**
 * The machine-facing API, driven through its real route handlers.
 *
 * Every rule here is about what a key can do when nobody is watching, which is
 * the only condition this API ever runs under. The one that matters most is
 * negative: there is no endpoint that marks somebody else's work complete, and
 * the test for it asserts the route does not exist rather than trusting an
 * agent not to call it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { Frequency, InstanceStatus, Role } from "@prisma/client";
import { databaseAvailable, prisma, seedFixture, type Fixture } from "./helpers/db";
import { generateToken, hashToken, identify, mintToken } from "@/lib/api-tokens";
import { addDays, toDbDate, todayInLondon } from "@/lib/time";

// guards.ts imports the session helper at module scope, which drags next-auth
// in. These routes never look at a session — they authenticate a bearer token
// — so the import is stubbed rather than the suite being given a fake login.
vi.mock("@/lib/auth", () => ({ auth: async () => null }));
vi.mock("@/lib/db", async () => ({ prisma: (await import("./helpers/db")).prisma }));

const overview = await import("@/app/api/agent/overview/route");
const notDone = await import("@/app/api/agent/instances/[id]/not-done/route");
const comments = await import("@/app/api/agent/instances/[id]/comments/route");

const available = await databaseAvailable();
const describeDb = available ? describe : describe.skip;

describeDb("the agent API", () => {
  let fixture: Fixture;
  let token: string;
  /** The agent's own identity, deliberately not the admin's. */
  let agentId: string;
  const today = todayInLondon();

  beforeEach(async () => {
    fixture = await seedFixture();
    const agent = await prisma.user.create({
      data: {
        organisationId: fixture.orgId,
        email: "claude@example.com",
        name: "Claude",
        role: Role.ADMIN,
        isActive: true,
        passwordHash: "",
        mustChangePassword: false,
      },
      select: { id: true },
    });
    agentId = agent.id;
    ({ token } = await mintToken(prisma, {
      userId: agentId,
      organisationId: fixture.orgId,
      name: "Claude",
    }));
  });

  async function instance(status: InstanceStatus = InstanceStatus.PENDING, dayOffset = -1) {
    const template = await prisma.taskTemplate.create({
      data: {
        organisationId: fixture.orgId,
        title: "Check the range",
        frequency: Frequency.DAILY,
        daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
        startDate: toDbDate(addDays(today, dayOffset)),
        assigneeId: fixture.memberId,
        createdById: fixture.adminId,
      },
    });
    return prisma.taskInstance.create({
      data: {
        organisationId: fixture.orgId,
        templateId: template.id,
        dueDate: toDbDate(addDays(today, dayOffset)),
        title: "Check the range",
        assigneeId: fixture.memberId,
        status,
      },
      select: { id: true },
    });
  }

  const get = (path: string, bearer: string | null = token) =>
    new Request(`http://localhost${path}`, {
      headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
    });

  const post = (path: string, body: unknown, bearer: string | null = token) =>
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      },
      body: JSON.stringify(body),
    });

  // --- The door --------------------------------------------------------

  it("turns away a request with no token", async () => {
    expect((await overview.GET(get("/api/agent/overview", null))).status).toBe(401);
  });

  it("turns away a token that was never minted", async () => {
    expect((await overview.GET(get("/api/agent/overview", generateToken()))).status).toBe(401);
  });

  it("turns away a revoked token", async () => {
    await prisma.apiToken.updateMany({ data: { revokedAt: new Date() } });
    expect((await overview.GET(get("/api/agent/overview"))).status).toBe(401);
  });

  /** Deactivating somebody takes their key with them, like their session. */
  it("turns away a token whose person has been deactivated", async () => {
    await prisma.user.update({ where: { id: agentId }, data: { isActive: false } });
    expect(await identify(prisma, token)).toBeNull();
  });

  it("turns away a member's token, because this API reads the whole team", async () => {
    const { token: memberToken } = await mintToken(prisma, {
      userId: fixture.memberId,
      organisationId: fixture.orgId,
      name: "Not an admin",
    });
    expect((await overview.GET(get("/api/agent/overview", memberToken))).status).toBe(403);
  });

  it("never stores the token itself", async () => {
    const row = await prisma.apiToken.findFirstOrThrow();
    expect(row.tokenHash).not.toBe(token);
    expect(row.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it("notes when a key was last used, so a dead one can be spotted", async () => {
    expect((await prisma.apiToken.findFirstOrThrow()).lastUsedAt).toBeNull();
    await overview.GET(get("/api/agent/overview"));
    expect((await prisma.apiToken.findFirstOrThrow()).lastUsedAt).not.toBeNull();
  });

  // --- Reading ---------------------------------------------------------

  it("answers how we are doing in one call", async () => {
    await instance(InstanceStatus.PENDING, -2);

    const body = await (await overview.GET(get("/api/agent/overview?days=30"))).json();
    expect(body.totals).toHaveProperty("completionRate");
    expect(body.overdue[0]).toMatchObject({ title: "Check the range", daysLate: 2 });
    expect(body.people.length).toBeGreaterThan(0);
  });

  it("does not call work overdue that is not due yet", async () => {
    await instance(InstanceStatus.PENDING, 1);
    const body = await (await overview.GET(get("/api/agent/overview"))).json();
    expect(body.overdue).toEqual([]);
  });

  // --- Writing ---------------------------------------------------------

  it("writes a task off, with the reason on the record", async () => {
    const row = await instance();
    const response = await notDone.POST(
      post(`/api/agent/instances/${row.id}/not-done`, { reason: "Range shut for resurfacing." }),
      { params: Promise.resolve({ id: row.id }) },
    );

    expect(response.status).toBe(200);
    const after = await prisma.taskInstance.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe(InstanceStatus.MISSED);
    expect(after.note).toBe("Range shut for resurfacing.");
  });

  it("refuses to write a task off with no reason", async () => {
    const row = await instance();
    const response = await notDone.POST(
      post(`/api/agent/instances/${row.id}/not-done`, { reason: "   " }),
      { params: Promise.resolve({ id: row.id }) },
    );
    expect(response.status).toBe(422);
    const after = await prisma.taskInstance.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe(InstanceStatus.PENDING);
  });

  /**
   * The agent types it, so the agent is the author. It is somebody else's
   * sentence, so their name is on it too. Neither fact is allowed to hide the
   * other in a thread people argue from.
   */
  it("posts a relayed reply as itself, naming whose words they are", async () => {
    const row = await instance();
    await comments.POST(
      post(`/api/agent/instances/${row.id}/comments`, {
        body: "Push it to Friday, the machine is booked.",
        onBehalfOf: fixture.adminId,
      }),
      { params: Promise.resolve({ id: row.id }) },
    );

    const comment = await prisma.comment.findFirstOrThrow({ where: { instanceId: row.id } });
    // The two must differ, or the test cannot tell the author from the person
    // whose words these are — which is the whole point of the field.
    expect(comment.authorId).toBe(agentId);
    expect(comment.onBehalfOfId).toBe(fixture.adminId);
    expect(comment.authorId).not.toBe(comment.onBehalfOfId);
    expect(comment.body).toBe("Push it to Friday, the machine is booked.");
  });

  it("will not hang a stranger's name on a comment", async () => {
    const row = await instance();
    const response = await comments.POST(
      post(`/api/agent/instances/${row.id}/comments`, {
        body: "Not mine to say.",
        onBehalfOf: "someone-from-another-org",
      }),
      { params: Promise.resolve({ id: row.id }) },
    );
    expect(response.status).toBe(422);
    expect(await prisma.comment.count()).toBe(0);
  });

  /**
   * The load-bearing absence. Marking somebody else's work done is the one
   * action that puts a lie in the record, so it is not reachable — not
   * guarded, not discouraged, absent.
   */
  it("has no way to mark somebody else's work complete", async () => {
    const routes = await import("node:fs/promises");
    const entries = await routes.readdir("src/app/api/agent/instances/[id]");
    expect(entries).not.toContain("complete");
    expect(entries.sort()).toEqual(["comments", "not-done"]);
  });
});
