import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logInbound, logRejection, verifySlackRequest } from "@/lib/slack-verify";
import { completeFromButton } from "@/lib/slack-actions";
import { respond } from "@/lib/slack";

export const dynamic = "force-dynamic";

/**
 * Block Kit interactions — the Done buttons on the morning brief.
 *
 * Slack sends these form-encoded with the payload as a JSON string, not as a
 * JSON body. The signature is over the form-encoded bytes, so verification
 * happens before any parsing.
 *
 * Every path through here logs what it decided. A tap that quietly does nothing
 * is the failure mode this endpoint actually had, and silence made it
 * impossible to tell a payload we declined from a request that never arrived.
 */
export async function POST(request: Request) {
  const raw = await request.text();

  const verified = verifySlackRequest(raw, request.headers);
  if (!verified.ok) {
    logRejection("interactive", verified.reason);
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  const encoded = new URLSearchParams(raw).get("payload");
  if (!encoded) {
    logInbound("interactive", "ignored", "no payload field");
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  let payload: InteractionPayload;
  try {
    payload = JSON.parse(encoded) as InteractionPayload;
  } catch {
    logInbound("interactive", "ignored", "payload is not JSON");
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  if (payload.type !== "block_actions") {
    logInbound("interactive", "ignored", `type ${payload.type ?? "missing"}`);
    return NextResponse.json({ ok: true });
  }

  const action = payload.actions?.[0];
  const slackUserId = payload.user?.id;
  const instanceId = typeof action?.value === "string" ? action.value : null;

  if (!action?.action_id?.startsWith("complete:") || !slackUserId || !instanceId) {
    logInbound("interactive", "ignored", `action ${action?.action_id ?? "missing"}`);
    return NextResponse.json({ ok: true });
  }

  logInbound("interactive", "complete", `${slackUserId} → ${instanceId}`);

  // Same three-second budget as events. Acknowledge, then update the message.
  void completeFromButton(prisma, slackUserId, instanceId)
    .then(async (reply) => {
      logInbound("interactive", "replied", reply.text.slice(0, 60));
      if (!payload.response_url) return;
      // replace_original:false — the brief lists several tasks and replacing it
      // wholesale would wipe the rows they have not tapped yet.
      const sent = await respond(payload.response_url, {
        text: reply.text,
        replace_original: false,
      });
      if (!sent.ok) logInbound("interactive", "reply failed", sent.error ?? "unknown");
    })
    .catch((error: unknown) => {
      // Swallowed, but never silently: the tap has already been acknowledged,
      // so this is the only place the failure can surface at all.
      logInbound(
        "interactive",
        "threw",
        error instanceof Error ? error.message : "unknown error",
      );
    });

  return NextResponse.json({ ok: true });
}

type InteractionPayload = {
  type?: string;
  response_url?: string;
  user?: { id?: string };
  actions?: { action_id?: string; value?: string }[];
};
