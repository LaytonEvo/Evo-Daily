import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifySlackRequest } from "@/lib/slack-verify";
import { completeFromButton } from "@/lib/slack-actions";
import { respond } from "@/lib/slack";

export const dynamic = "force-dynamic";

/**
 * Block Kit interactions — the Done buttons on the morning brief.
 *
 * Slack sends these form-encoded with the payload as a JSON string, not as a
 * JSON body. The signature is over the form-encoded bytes, so verification
 * happens before any parsing.
 */
export async function POST(request: Request) {
  const raw = await request.text();

  const verified = verifySlackRequest(raw, request.headers);
  if (!verified.ok) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  const encoded = new URLSearchParams(raw).get("payload");
  if (!encoded) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  let payload: InteractionPayload;
  try {
    payload = JSON.parse(encoded) as InteractionPayload;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  if (payload.type !== "block_actions") return NextResponse.json({ ok: true });

  const action = payload.actions?.[0];
  const slackUserId = payload.user?.id;
  const instanceId = typeof action?.value === "string" ? action.value : null;

  if (!action?.action_id?.startsWith("complete:") || !slackUserId || !instanceId) {
    return NextResponse.json({ ok: true });
  }

  // Same three-second budget as events. Acknowledge, then update the message.
  void completeFromButton(prisma, slackUserId, instanceId)
    .then((reply) => {
      if (!payload.response_url) return;
      // replace_original:false — the brief lists several tasks and replacing it
      // wholesale would wipe the rows they have not tapped yet.
      return respond(payload.response_url, { text: reply.text, replace_original: false });
    })
    .catch(() => undefined);

  return NextResponse.json({ ok: true });
}

type InteractionPayload = {
  type?: string;
  response_url?: string;
  user?: { id?: string };
  actions?: { action_id?: string; value?: string }[];
};
