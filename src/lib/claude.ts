/**
 * Reading what someone typed into Slack.
 *
 * Buttons handle the common path — the morning brief carries a Done button per
 * task, and a tap is unambiguous. This is for the rest: "done the stock take,
 * we ran out of range balls", or an admin adding a task in a sentence.
 *
 * The model's only job is to turn a sentence into a structured intent against a
 * list of candidate tasks it is given. It never decides who the user is, never
 * sees another person's tasks, and cannot complete anything itself — it returns
 * an id from the list it was handed, and the caller re-checks that id against
 * the database with the real permission rules.
 *
 * Env-gated like Slack: with no ANTHROPIC_API_KEY the free-text path reports
 * itself unavailable and the buttons carry on working.
 */

import Anthropic from "@anthropic-ai/sdk";

export function claudeEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  client ??= new Anthropic();
  return client;
}

export type Candidate = { id: string; title: string; dueDate: string; overdue: boolean };

export type Intent =
  | { kind: "complete"; instanceId: string; note: string | null }
  | { kind: "create"; title: string; assignee: string | null; schedule: string | null }
  | { kind: "list" }
  | { kind: "unclear"; reply: string };

const INTENT_SCHEMA = {
  type: "object" as const,
  properties: {
    kind: {
      type: "string" as const,
      enum: ["complete", "create", "list", "unclear"],
      description:
        "complete: they are reporting a task done. create: an admin is asking for a new recurring task. list: they want to see what they owe. unclear: anything else, or a task you cannot confidently identify.",
    },
    instanceId: {
      type: ["string", "null"] as const,
      description:
        "For kind=complete only. Must be one of the given task ids, copied exactly. Null if no task clearly matches.",
    },
    note: {
      type: ["string", "null"] as const,
      description:
        "For kind=complete. Anything they said about how it went that is worth keeping on the record — a problem, a shortfall, a caveat. Null if they only said it was done.",
    },
    title: {
      type: ["string", "null"] as const,
      description: "For kind=create. The task title, phrased as an instruction.",
    },
    assignee: {
      type: ["string", "null"] as const,
      description: "For kind=create. The person's name as written, or null if unstated.",
    },
    schedule: {
      type: ["string", "null"] as const,
      description:
        "For kind=create. How often, in their words, e.g. 'every weekday', 'Mondays', 'first of the month'. Null if unstated.",
    },
    reply: {
      type: ["string", "null"] as const,
      description:
        "For kind=unclear. One short sentence back to them saying what you need. No greeting, no sign-off.",
    },
  },
  required: ["kind", "instanceId", "note", "title", "assignee", "schedule", "reply"],
  additionalProperties: false,
};

const SYSTEM = `You read short Slack messages from staff at a golf retailer and turn them into one structured intent.

You are given the tasks currently open for the person who wrote the message. When they say something is done, match it to exactly one of those tasks and return its id verbatim. Match on meaning, not wording — "stock take" should find "Record range ball stock level". If two tasks fit equally well, or none does, return kind "unclear" and ask which one.

Capture a note whenever they mention how it went — a shortfall, a problem, something left over. The note is what someone reads in a month when the number looks wrong, so keep their specifics. Do not write a note that just says the task was done.

Only treat a message as kind "create" when someone is asking for a new recurring duty to exist. Reporting work done is never "create".

Be strict about matching. Completing the wrong task is worse than asking.`;

/**
 * Never throws. Slack has a three-second budget and a model outage must degrade
 * to "I did not understand" rather than a failed request.
 */
export async function readIntent(
  message: string,
  candidates: Candidate[],
  options: { isAdmin: boolean },
): Promise<Intent> {
  if (!claudeEnabled()) {
    return { kind: "unclear", reply: "I can only take taps on the buttons at the moment." };
  }

  const taskList = candidates.length
    ? candidates
        .map((c) => `- id=${c.id} | ${c.title} | due ${c.dueDate}${c.overdue ? " (overdue)" : ""}`)
        .join("\n")
    : "(nothing open)";

  try {
    const response = await getClient().messages.create({
      model: "claude-opus-5",
      max_tokens: 1024,
      // Adaptive thinking at low effort: the job is short and well-specified,
      // and Slack is waiting.
      thinking: { type: "adaptive" },
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: INTENT_SCHEMA },
      },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            `Their open tasks:\n${taskList}`,
            options.isAdmin
              ? "They are an admin, so they may also ask for new tasks to be created."
              : "They are not an admin. Never return kind \"create\" for them.",
            `Their message:\n${message}`,
          ].join("\n\n"),
        },
      ],
    });

    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") return unclear();
    return toIntent(JSON.parse(text.text), candidates, options.isAdmin);
  } catch {
    // Rate limit, outage, malformed JSON — all the same to the person waiting.
    return unclear();
  }
}

function unclear(): Intent {
  return { kind: "unclear", reply: "I did not follow that. Which task do you mean?" };
}

/**
 * The model's answer is untrusted input. An id it did not get from the
 * candidate list is a hallucination, and acting on one would complete an
 * arbitrary task.
 */
function toIntent(raw: unknown, candidates: Candidate[], isAdmin: boolean): Intent {
  const value = raw as Record<string, unknown>;
  const kind = String(value.kind ?? "");

  if (kind === "complete") {
    const id = typeof value.instanceId === "string" ? value.instanceId : null;
    if (!id || !candidates.some((c) => c.id === id)) return unclear();
    const note = typeof value.note === "string" && value.note.trim() ? value.note.trim() : null;
    return { kind: "complete", instanceId: id, note };
  }

  if (kind === "create") {
    if (!isAdmin) return unclear();
    const title = typeof value.title === "string" ? value.title.trim() : "";
    if (!title) return unclear();
    return {
      kind: "create",
      title,
      assignee: typeof value.assignee === "string" && value.assignee.trim() ? value.assignee.trim() : null,
      schedule: typeof value.schedule === "string" && value.schedule.trim() ? value.schedule.trim() : null,
    };
  }

  if (kind === "list") return { kind: "list" };

  const reply = typeof value.reply === "string" && value.reply.trim() ? value.reply.trim() : null;
  return reply ? { kind: "unclear", reply } : unclear();
}
