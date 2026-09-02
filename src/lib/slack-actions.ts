/**
 * What a Slack message or button tap actually does.
 *
 * Identity comes from one place: the Slack user id is looked up against
 * User.slackUserId. An unmapped or deactivated Slack account gets nothing —
 * it is not an anonymous caller, it is a stranger. Everything past that point
 * runs through the same services and the same permission checks as the web app,
 * so the grace window, the audit log and admin-only rules all still apply.
 */

import { InstanceStatus, Role, type PrismaClient } from "@prisma/client";
import { completeInstance, TransitionError, type Actor } from "./instances";
import { readIntent, type Candidate } from "./claude";
import { escape } from "./slack";
import { formatDateOnly, toDbDate, todayInLondon } from "./time";

export type SlackReply = { text: string; blocks?: Record<string, unknown>[] };

type Person = { id: string; name: string; role: Role; organisationId: string };

/** Null when the Slack account maps to nobody we will act for. */
export async function personForSlackUser(
  db: PrismaClient,
  slackUserId: string,
): Promise<Person | null> {
  const user = await db.user.findFirst({
    where: { slackUserId, isActive: true },
    select: { id: true, name: true, role: true, organisationId: true },
  });
  return user;
}

function actorFor(person: Person): Actor {
  return { id: person.id, role: person.role, organisationId: person.organisationId };
}

/** Everything still owed, today or earlier. The candidate set for matching. */
export async function openTasks(db: PrismaClient, person: Person, today = todayInLondon()) {
  return db.taskInstance.findMany({
    where: {
      assigneeId: person.id,
      status: InstanceStatus.PENDING,
      dueDate: { lte: toDbDate(today) },
    },
    orderBy: [{ dueDate: "asc" }, { dueAt: "asc" }],
    select: { id: true, title: true, dueDate: true, dueAt: true },
  });
}

function toCandidates(
  tasks: { id: string; title: string; dueDate: Date }[],
  today: string,
): Candidate[] {
  return tasks.map((t) => ({
    id: t.id,
    title: t.title,
    dueDate: formatDateOnly(t.dueDate),
    overdue: t.dueDate < toDbDate(today),
  }));
}

/** The Done button. The id came from us, so there is nothing to interpret. */
export async function completeFromButton(
  db: PrismaClient,
  slackUserId: string,
  instanceId: string,
): Promise<SlackReply> {
  const person = await personForSlackUser(db, slackUserId);
  if (!person) return { text: notLinked() };

  try {
    const updated = await completeInstance(db, instanceId, actorFor(person));
    return { text: `:white_check_mark: ${escape(updated.title)} — done.` };
  } catch (error) {
    return { text: failureText(error) };
  }
}

/** A typed message. */
export async function handleMessage(
  db: PrismaClient,
  slackUserId: string,
  message: string,
): Promise<SlackReply> {
  const person = await personForSlackUser(db, slackUserId);
  if (!person) return { text: notLinked() };

  const today = todayInLondon();
  const tasks = await openTasks(db, person, today);
  const intent = await readIntent(message, toCandidates(tasks, today), {
    isAdmin: person.role === Role.ADMIN,
  });

  if (intent.kind === "list") return { text: listText(tasks, today) };

  if (intent.kind === "complete") {
    try {
      const updated = await completeInstance(db, intent.instanceId, actorFor(person), {
        ...(intent.note !== null ? { note: intent.note } : {}),
      });
      const noted = intent.note ? `\n> ${escape(intent.note)}` : "";
      return { text: `:white_check_mark: ${escape(updated.title)} — done.${noted}` };
    } catch (error) {
      return { text: failureText(error) };
    }
  }

  if (intent.kind === "create") {
    // Deliberately not created here. A recurring task needs a schedule, an
    // owner and a category, and guessing any of them produces a task that
    // quietly generates wrong work every day. The sentence is carried over to
    // the form instead, which takes about a minute.
    const parts = [
      `Ready to add *${escape(intent.title)}*.`,
      intent.assignee ? `Owner: ${escape(intent.assignee)}.` : "No owner named.",
      intent.schedule ? `Schedule: ${escape(intent.schedule)}.` : "No schedule named.",
      "I have not created it — a recurring task needs an exact schedule and owner, and a wrong guess generates wrong work every day. Finish it in Tasks → New task.",
    ];
    return { text: parts.join(" ") };
  }

  return { text: intent.reply };
}

function listText(
  tasks: { title: string; dueDate: Date }[],
  today: string,
): string {
  if (tasks.length === 0) return "Nothing open. Your day is clear.";
  const lines = tasks.map((t) => {
    const overdue = t.dueDate < toDbDate(today);
    return `• ${escape(t.title)}${overdue ? ` — *overdue from ${formatDateOnly(t.dueDate)}*` : ""}`;
  });
  return [`*${tasks.length} open*`, ...lines].join("\n");
}

function notLinked(): string {
  return "I do not recognise this Slack account. Ask an admin to add your Slack member ID to your EvoTasks profile.";
}

function failureText(error: unknown): string {
  if (error instanceof TransitionError) return error.message;
  return "Something went wrong saving that. It is not marked done.";
}
