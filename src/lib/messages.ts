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

export type Thread = {
  instanceId: string;
  title: string;
  dueDate: DateOnly;
  assigneeName: string;
  /** Mine to do, as opposed to one I am only talking on. */
  assignedToMe: boolean;
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
export async function threadsFor(db: PrismaClient, viewer: Viewer): Promise<Thread[]> {
  const mine = {
    organisationId: viewer.organisationId,
    OR: [{ assigneeId: viewer.id }, { comments: { some: { authorId: viewer.id } } }],
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
  if (ids.length === 0) return [];

  const instances = await db.taskInstance.findMany({
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
      instanceId: instance.id,
      title: instance.title,
      dueDate: toDateOnly(instance.dueDate),
      assigneeName: instance.assignee.name,
      assignedToMe: instance.assigneeId === viewer.id,
      comments,
      // Your own words are never news, whichever screen you wrote them on.
      unread: comments.filter(
        (c) => !c.mine && (readAt === null || c.createdAt > readAt),
      ).length,
      lastAt: comments[comments.length - 1]?.createdAt ?? instance.dueDate,
    };
  });

  // By the last thing said, not by when the task was due: a three-week-old
  // task somebody answered this morning is the one you came here for.
  return threads.sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime());
}

/** What the badge says. */
export async function unreadCountFor(db: PrismaClient, viewer: Viewer): Promise<number> {
  const threads = await threadsFor(db, viewer);
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
