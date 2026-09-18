/**
 * The Done button, end to end through the route handler.
 *
 * The unit tests cover completeFromButton, but the button failed in production
 * with the unit tests passing: every way the route can decline to act — a
 * signature it will not accept, a payload shape it does not recognise — ends in
 * the same silent `{ ok: true }`, and nothing between Slack and the database
 * was covered. This drives the real handler with the bytes Slack actually
 * sends, signed the way Slack signs them.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
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
import { todayInLondon } from "@/lib/time";

const SECRET = "test-signing-secret";

const replies = vi.hoisted(() => ({ sent: [] as { url: string; body: unknown }[] }));
vi.mock("@/lib/db", async () => ({ prisma: (await import("./helpers/db")).prisma }));
vi.mock("@/lib/slack", async () => {
  const actual = await vi.importActual<typeof import("@/lib/slack")>("@/lib/slack");
  return {
    ...actual,
    respond: async (url: string, body: unknown) => {
      replies.sent.push({ url, body });
      return { ok: true };
    },
  };
});

const { POST } = await import("@/app/api/slack/interactive/route");
const { taskBlocks } = await import("@/lib/slack-blocks");

const available = await databaseAvailable();
const describeDb = available ? describe : describe.skip;

const TODAY = todayInLondon();

/** The bytes Slack sends: form-encoded, with the interaction as a JSON string. */
function encode(payload: unknown): string {
  return new URLSearchParams({ payload: JSON.stringify(payload) }).toString();
}

function sign(body: string, secret = SECRET, at = new Date()): Headers {
  const ts = String(Math.floor(at.getTime() / 1000));
  const signature =
    "v0=" + crypto.createHmac("sha256", secret).update(`v0:${ts}:${body}`).digest("hex");
  return new Headers({
    "content-type": "application/x-www-form-urlencoded",
    "x-slack-request-timestamp": ts,
    "x-slack-signature": signature,
  });
}

function post(body: string, headers: Headers): Promise<Response> {
  return POST(
    new Request("https://evotasks.test/api/slack/interactive", { method: "POST", body, headers }),
  );
}

/** The handler acknowledges before it finishes; the work lands a tick later. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await new Promise((r) => setTimeout(r, 10));
}

describeDb("slack interactive route", () => {
  let fixture: Fixture;
  let instanceId: string;

  beforeEach(async () => {
    process.env.SLACK_SIGNING_SECRET = SECRET;
    replies.sent = [];

    fixture = await seedFixture();
    await prisma.user.update({
      where: { id: fixture.memberId },
      data: { slackUserId: "U_ALEX" },
    });

    const template = await createTemplate(fixture, {
      title: "Record range ball stock level",
      startDate: TODAY,
      assigneeId: fixture.memberId,
    });
    await generateInstances(prisma, TODAY, TODAY);
    const [instance] = await instancesFor(template.id);
    instanceId = instance.id;
  });

  /**
   * The payload below is built from the same blocks the brief sends, so an
   * action_id or value that changes shape fails here rather than in Slack.
   */
  function tap(slackUserId = "U_ALEX", id = instanceId) {
    const [block] = taskBlocks([{ id, title: "Record range ball stock level", dueAt: null, overdue: false }]);
    const accessory = (block as { accessory: { action_id: string; value: string } }).accessory;
    return {
      type: "block_actions",
      response_url: "https://hooks.slack.test/actions/1",
      user: { id: slackUserId },
      actions: [{ action_id: accessory.action_id, value: accessory.value }],
    };
  }

  it("completes the task behind a tapped Done button", async () => {
    const body = encode(tap());
    const response = await post(body, sign(body));
    expect(response.status).toBe(200);

    await settle();

    const [after] = await instancesFor((await prisma.taskInstance.findUniqueOrThrow({
      where: { id: instanceId },
      select: { templateId: true },
    })).templateId);
    expect(after.status).toBe(InstanceStatus.COMPLETED);
    expect(replies.sent).toHaveLength(1);
  });

  it("acknowledges Slack even so, because a retry would double-post", async () => {
    const body = encode(tap());
    const response = await post(body, sign(body, "the-wrong-secret"));
    expect(response.status).toBe(401);

    await settle();
    const after = await prisma.taskInstance.findUniqueOrThrow({ where: { id: instanceId } });
    expect(after.status).toBe(InstanceStatus.PENDING);
  });

  it("does not complete somebody else's task", async () => {
    const body = encode(tap("U_NOBODY"));
    await post(body, sign(body));
    await settle();

    const after = await prisma.taskInstance.findUniqueOrThrow({ where: { id: instanceId } });
    expect(after.status).toBe(InstanceStatus.PENDING);
    expect(replies.sent).toHaveLength(1);
  });
});
