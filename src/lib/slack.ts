/**
 * Slack nudges — Phase 3.
 *
 * Blunt point, and it matters more than any feature above: a nicer screen will
 * not by itself fix tasks not being completed. The tool removes friction; it
 * does not create accountability. The two things that create accountability are
 * a prompt at the right moment and the numbers being visible to someone who
 * will ask about them. This file is the first half. The second half is a fixed
 * ten minutes on the leaderboard in the weekly management meeting.
 *
 * Everything here is env-gated. With no SLACK_BOT_TOKEN the app runs exactly
 * as it does today and every job below reports itself as skipped.
 */

const SLACK_API = "https://slack.com/api";

export function slackEnabled(): boolean {
  return Boolean(process.env.SLACK_BOT_TOKEN);
}

export function managerChannelId(): string | null {
  return process.env.SLACK_MANAGER_CHANNEL_ID || null;
}

/** Slack Block Kit. Loosely typed — we build every block we send. */
export type Block = Record<string, unknown>;

export function appUrl(path = ""): string {
  const base = (process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "");
  return `${base}${path}`;
}

type PostResult = { ok: boolean; error?: string };

/**
 * Post a message. A Slack outage must never take the app down or fail a cron
 * run, so every failure is reported back rather than thrown.
 */
export async function postMessage(
  channel: string,
  text: string,
  blocks?: Block[],
): Promise<PostResult> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return { ok: false, error: "slack_not_configured" };

  try {
    const response = await fetch(`${SLACK_API}/chat.postMessage`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json; charset=utf-8",
      },
      // `text` is still sent alongside blocks: it is what a phone notification
      // and a screen reader read out.
      body: JSON.stringify({ channel, text, unfurl_links: false, ...(blocks ? { blocks } : {}) }),
    });

    const body = (await response.json()) as { ok: boolean; error?: string };
    return { ok: body.ok, error: body.error };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "request_failed" };
  }
}

/** Slack's mrkdwn escaping. Task titles are user-supplied. */
export function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function link(url: string, label: string): string {
  return `<${url}|${escape(label)}>`;
}

/**
 * Replace a message in place, used to grey out a task the moment its button is
 * tapped. Slack gives a response_url with every interaction; it needs no token
 * and works for five actions over thirty minutes, which is ample for one tap.
 */
export async function respond(
  responseUrl: string,
  body: { text: string; blocks?: Block[]; replace_original?: boolean },
): Promise<PostResult> {
  try {
    const response = await fetch(responseUrl, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ replace_original: true, ...body }),
    });
    return { ok: response.ok };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "request_failed" };
  }
}
