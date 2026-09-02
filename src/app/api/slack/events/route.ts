import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifySlackRequest } from "@/lib/slack-verify";
import { handleMessage } from "@/lib/slack-actions";
import { postMessage } from "@/lib/slack";

export const dynamic = "force-dynamic";

/**
 * Slack Events API — DMs to the bot.
 *
 * Slack retries anything it does not hear back from within three seconds, and a
 * retry would run the message twice. Claude takes longer than that, so this
 * acknowledges immediately and does the work after responding.
 */
export async function POST(request: Request) {
  const raw = await request.text();

  const verified = verifySlackRequest(raw, request.headers);
  if (!verified.ok) {
    // 401 and nothing else: an unsigned caller learns nothing about why.
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  let payload: SlackEvent;
  try {
    payload = JSON.parse(raw) as SlackEvent;
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  // One-off handshake when the endpoint is first pointed at this URL.
  if (payload.type === "url_verification") {
    return NextResponse.json({ challenge: payload.challenge });
  }

  const event = payload.event;
  const isUserDm =
    payload.type === "event_callback" &&
    event?.type === "message" &&
    event.channel_type === "im" &&
    // The bot's own messages come back as events; answering them is a loop.
    !event.bot_id &&
    !event.subtype &&
    typeof event.text === "string" &&
    typeof event.user === "string" &&
    typeof event.channel === "string";

  if (!isUserDm || !event) return NextResponse.json({ ok: true });

  // A retry means our first reply was slow, not that it failed. Acting again
  // would double-post; completion itself is idempotent, but the reply is not.
  if (request.headers.get("x-slack-retry-num")) return NextResponse.json({ ok: true });

  const { user, channel, text } = event as { user: string; channel: string; text: string };

  void handleMessage(prisma, user, text)
    .then((reply) => postMessage(channel, reply.text, reply.blocks))
    .catch(() => postMessage(channel, "Something went wrong. Nothing was changed."));

  return NextResponse.json({ ok: true });
}

type SlackEvent = {
  type: string;
  challenge?: string;
  event?: {
    type?: string;
    subtype?: string;
    channel_type?: string;
    bot_id?: string;
    user?: string;
    channel?: string;
    text?: string;
  };
};
