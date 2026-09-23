/**
 * Threads, and what is new in them.
 *
 * Comments have always worked: a member could read and reply on any task of
 * theirs, however old, and the rules allowed it. There was simply nowhere to
 * see that a reply existed. The thread loaded only when you opened that one
 * task, so finding an answer meant opening every task in turn, and a task more
 * than a day old had left the screen entirely.
 *
 * A thread is one you are in: a task assigned to you, or one you have written
 * on. The same rule for everybody, so an admin who asks a question on somebody
 * else's task hears the answer without watching for it.
 */

import { Role, type PrismaClient } from "@prisma/client";
import { toDateOnly, type DateOnly } from "./time";

/** Enough history to be a record, few enough to be one query. */
export const MAX_THREADS = 100;

/**
 * How many recent comments to look through to find those threads. Bounded so
 * the query cannot grow without limit; generous enough that it covers years
 * of a shop this size.
 */
const COMMENT_SCAN = 1000;

export type ThreadComment = {
  id: string;
  body: string;
  createdAt: Date;
  authorId: string;
  authorName: string;
  mine: boolean;
  attachments: number;
};

export type ThreadScope = "mine" | "all";

export type ThreadKind = "task" | "day-check";

export type Thread = {
  /** The instance id, or the day check id. Unique either way. */
  id: string;
  kind: ThreadKind;
  title: string;
  dueDate: DateOnly;
  assigneeName: string;
  /** Mine to do, as opposed to one I am only talking on. */
  assignedToMe: boolean;
  /**
   * I own the task or have written on it. False only in the everyone view:
   * an admin reading a conversation between two other people is not behind on
   * it, so it carries no unread count.
   */
  inThread: boolean;
  comments: ThreadComment[];
  /** By somebody else, since I last opened it. */
  unread: number;
  lastAt: Date;
};

type Viewer = { id: string; organisationId: string; role: Role };

/**
 * Every thread this person is in, most recently active first.
 *
 * No date window anywhere in here, deliberately. The whole complaint is that a
 * conversation became unreachable the moment its task aged off the day screen,
 * and a window is how that happens.
 */
export async function threadsFor(
  db: PrismaClient,
  viewer: Viewer,
  scope: ThreadScope = "mine",
): Promise<Thread[]> {
  const ownership = {
    OR: [{ assigneeId: viewer.id }, { comments: { some: { authorId: viewer.id } } }],
  };

  // "Everyone" is every conversation in the organisation, and admins only.
  // A member asking for it gets their own, rather than an error: there is
  // nothing to tell them they cannot have, because the option is not offered
  // to them in the first place.
  const everyone = scope === "all" && viewer.role === Role.ADMIN;
  const mine = {
    organisationId: viewer.organisationId,
    ...(everyone ? {} : ownership),
  };

  // Which threads are the most recent is a question about the comments, not
  // the tasks: an instance's updatedAt does not move when somebody writes on
  // it, so ordering instances by it would pick the hundred most recently
  // *completed*, and drop the three-week-old task answered this morning —
  // exactly the one worth surfacing.
  const recent = await db.comment.findMany({
    where: { instance: mine },
    orderBy: { createdAt: "desc" },
    select: { instanceId: true },
    take: COMMENT_SCAN,
  });
  const ids = [...new Set(recent.map((c) => c.instanceId))].slice(0, MAX_THREADS);

  // Not an early return, however tempting: day checks are threads too, and
  // somebody whose only message is an under-half answer has no task comments
  // at all. Returning here would show them an empty inbox.
  const instances = ids.length === 0 ? [] : await db.taskInstance.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      title: true,
      dueDate: true,
      assigneeId: true,
      assignee: { select: { name: true } },
      comments: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          body: true,
          createdAt: true,
          authorId: true,
          author: { select: { name: true } },
          _count: { select: { attachments: true } },
        },
      },
      reads: { where: { userId: viewer.id }, select: { readAt: true } },
    },
  });

  const threads = instances.map((instance) => {
    const readAt = instance.reads[0]?.readAt ?? null;
    const inThread =
      instance.assigneeId === viewer.id ||
      instance.comments.some((c) => c.authorId === viewer.id);
    const comments: ThreadComment[] = instance.comments.map((c) => ({
      id: c.id,
      body: c.body,
      createdAt: c.createdAt,
      authorId: c.authorId,
      authorName: c.author.name,
      mine: c.authorId === viewer.id,
      attachments: c._count.attachments,
    }));

    return {
      id: instance.id,
      kind: "task" as const,
      title: instance.title,
      dueDate: toDateOnly(instance.dueDate),
      assigneeName: instance.assignee.name,
      assignedToMe: instance.assigneeId === viewer.id,
      inThread,
      comments,
      // Your own words are never news, whichever screen you wrote them on.
      // Neither is a conversation you are only reading over.
      unread: inThread
        ? comments.filter((c) => !c.mine && (readAt === null || c.createdAt > readAt)).length
        : 0,
      lastAt: comments[comments.length - 1]?.createdAt ?? instance.dueDate,
    };
  });

  const checks = await dayCheckThreads(db, viewer, everyone);

  // By the last thing said, not by when the task was due: a three-week-old
  // task somebody answered this morning is the one you came here for.
  return [...threads, ...checks].sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime());
}

/**
 * Under-half answers, as threads.
 *
 * A day check is addressed to the admins, so they are in the thread by right
 * rather than by having replied — which is the difference between this and a
 * task conversation, where reading over somebody's shoulder earns you no
 * badge. The point of the question is that somebody reads the answer.
 */
async function dayCheckThreads(
  db: PrismaClient,
  viewer: Viewer,
  everyone: boolean,
): Promise<Thread[]> {
  const admin = viewer.role === Role.ADMIN;

  // A member sees their own. An admin sees the team's, because that is who the
  // answer was written for.
  if (!admin && everyone) return [];
  const checks = await db.dayCheck.findMany({
    where: {
      organisationId: viewer.organisationId,
      ...(admin ? {} : { userId: viewer.id }),
    },
    orderBy: { createdAt: "desc" },
    take: MAX_THREADS,
    select: {
      id: true,
      userId: true,
      day: true,
      completed: true,
      total: true,
      reason: true,
      createdAt: true,
      user: { select: { name: true } },
      replies: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          body: true,
          createdAt: true,
          authorId: true,
          author: { select: { name: true } },
        },
      },
      reads: { where: { userId: viewer.id }, select: { readAt: true } },
    },
  });

  return checks.map((check) => {
    const readAt = check.reads[0]?.readAt ?? null;

    // The answer itself is the first thing said, so it reads as a message and
    // not as a header with a conversation stuck underneath it.
    const comments: ThreadComment[] = [
      {
        id: check.id,
        body: check.reason,
        createdAt: check.createdAt,
        authorId: check.userId,
        authorName: check.user.name,
        mine: check.userId === viewer.id,
        attachments: 0,
      },
      ...check.replies.map((reply) => ({
        id: reply.id,
        body: reply.body,
        createdAt: reply.createdAt,
        authorId: reply.authorId,
        authorName: reply.author.name,
        mine: reply.authorId === viewer.id,
        attachments: 0,
      })),
    ];

    return {
      id: check.id,
      kind: "day-check" as const,
      title: `Under half \u2014 ${check.completed} of ${check.total} done`,
      dueDate: toDateOnly(check.day),
      assigneeName: check.user.name,
      assignedToMe: check.userId === viewer.id,
      inThread: true,
      comments,
      unread: comments.filter((c) => !c.mine && (readAt === null || c.createdAt > readAt)).length,
      lastAt: comments[comments.length - 1].createdAt,
    };
  });
}

/**
 * What the badge says.
 *
 * Always the threads you are in, never the everyone view. A badge that counts
 * other people's conversations is one that is never zero, and a number that is
 * never zero stops being read.
 */
export async function unreadCountFor(db: PrismaClient, viewer: Viewer): Promise<number> {
  const threads = await threadsFor(db, viewer, "mine");
  return threads.reduce((sum, thread) => sum + thread.unread, 0);
}

/**
 * Mark a thread read up to now.
 *
 * Only for a thread the viewer is actually in — the instance id comes from the
 * client, and without the check anyone could mark a stranger's thread read,
 * which is harmless in itself and exactly the sort of thing that turns out not
 * to be later.
 */
export async function markThreadRead(
  db: PrismaClient,
  viewer: Viewer,
  instanceId: string,
): Promise<boolean> {
  // The client sends one id for both kinds of thread. Ids do not collide, so
  // the kind is recoverable without the caller having to say which it meant —
  // and a caller who has to say is a caller who can say the wrong thing.
  if (await markDayCheckRead(db, viewer, instanceId)) return true;

  const allowed = await db.taskInstance.findFirst({
    where: {
      id: instanceId,
      organisationId: viewer.organisationId,
      OR: [{ assigneeId: viewer.id }, { comments: { some: { authorId: viewer.id } } }],
    },
    select: { id: true },
  });
  if (!allowed) return false;

  const readAt = new Date();
  await db.commentRead.upsert({
    where: { userId_instanceId: { userId: viewer.id, instanceId } },
    create: { userId: viewer.id, instanceId, readAt },
    update: { readAt },
  });
  return true;
}

export type ViewedThreads = {
  person: { id: string; name: string; isActive: boolean };
  threads: Thread[];
};

/**
 * One person's threads, for an admin looking over their shoulder.
 *
 * The same two rules as viewing their day — admins only, same organisation,
 * null for both so a refusal and a missing id are indistinguishable. The id
 * comes from a URL and is not to be trusted.
 *
 * `unread` here means unread *by them*, which is the answer to the question
 * that brings anybody to this screen: I replied last night, has he seen it?
 * Nothing on this path writes a read marker — for the member, because it is
 * not their reading, or for the admin, because they are not in the thread and
 * silently clearing their own badge from a screen they are only watching is a
 * count that lies.
 */
export async function threadsForMember(
  db: PrismaClient,
  actor: Viewer,
  userId: string,
): Promise<ViewedThreads | null> {
  if (actor.role !== Role.ADMIN) return null;

  const person = await db.user.findFirst({
    where: { id: userId, organisationId: actor.organisationId },
    select: { id: true, name: true, isActive: true, role: true, organisationId: true },
  });
  if (!person) return null;

  const threads = await threadsFor(db, {
    id: person.id,
    organisationId: person.organisationId,
    role: person.role,
  });

  return {
    person: { id: person.id, name: person.name, isActive: person.isActive },
    threads,
  };
}


/** Mark a day check read, if that is what this id is. */
async function markDayCheckRead(
  db: PrismaClient,
  viewer: Viewer,
  dayCheckId: string,
): Promise<boolean> {
  const check = await db.dayCheck.findFirst({
    where: {
      id: dayCheckId,
      organisationId: viewer.organisationId,
      ...(viewer.role === Role.ADMIN ? {} : { userId: viewer.id }),
    },
    select: { id: true },
  });
  if (!check) return false;

  const readAt = new Date();
  await db.dayCheckRead.upsert({
    where: { userId_dayCheckId: { userId: viewer.id, dayCheckId } },
    create: { userId: viewer.id, dayCheckId, readAt },
    update: { readAt },
  });
  return true;
}

/**
 * Reply to a day check.
 *
 * Same audience as reading it: the person it is about, and the admins. A
 * member cannot answer somebody else's bad day, and an admin replying is the
 * entire point of routing these into Messages rather than a report nobody
 * opens.
 */
export async function replyToDayCheck(
  db: PrismaClient,
  viewer: Viewer,
  dayCheckId: string,
  body: string,
): Promise<boolean> {
  const text = body.trim();
  if (!text) return false;

  const check = await db.dayCheck.findFirst({
    where: {
      id: dayCheckId,
      organisationId: viewer.organisationId,
      ...(viewer.role === Role.ADMIN ? {} : { userId: viewer.id }),
    },
    select: { id: true },
  });
  if (!check) return false;

  await db.dayCheckReply.create({
    data: { dayCheckId, authorId: viewer.id, body: text.slice(0, 2000) },
  });
  return true;
}
