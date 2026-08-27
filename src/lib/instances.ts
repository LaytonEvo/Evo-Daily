/**
 * Status transitions for task instances.
 *
 *   PENDING   --tick--------->  COMPLETED   (wasLate = completedAt > dueAt)
 *   PENDING   --sweep-------->  MISSED      (today > dueDate + graceDays)
 *   COMPLETED --untick------->  PENDING     (within grace window; admins any time)
 *   MISSED    --admin override->COMPLETED
 *
 * Overdue is a derived display state, not a stored status: a PENDING instance
 * whose dueDate is before today. Every transition here writes exactly one
 * AuditLog row.
 */

import { InstanceStatus, Role, type Prisma, type PrismaClient } from "@prisma/client";
import { addDays, compareDateOnly, daysBetween, todayInLondon, type DateOnly } from "./time";
import { getSettings } from "./settings";

type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * Run the status update and its audit row together.
 *
 * When handed a full client this opens a transaction, so a status change can
 * never land without its AuditLog row. When already inside one — the caller
 * passed a TransactionClient — the writes simply join it.
 */
async function atomically<T>(
  db: DbClient,
  work: (tx: DbClient) => Promise<T>,
): Promise<T> {
  if ("$transaction" in db && typeof db.$transaction === "function") {
    return (db as PrismaClient).$transaction((tx) => work(tx));
  }
  return work(db);
}

export class TransitionError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
    this.name = "TransitionError";
  }
}

export type Actor = {
  id: string;
  role: Role;
  organisationId: string;
};

/**
 * Whether an instance may still be acted on by a member.
 *
 * Members may tick and untick anything inside the grace window — that is the
 * mis-tap recovery, and the Monday catch-up after a Friday miss. They may not
 * touch anything already hardened to MISSED. Admins are not gated.
 */
export function isWithinGraceWindow(
  dueDate: DateOnly | Date,
  graceDays: number,
  today: DateOnly = todayInLondon(),
): boolean {
  const cutoff = addDays(today, -graceDays);
  return compareDateOnly(dueDate, cutoff) >= 0;
}

async function loadInstanceFor(db: DbClient, instanceId: string, actor: Actor) {
  const instance = await db.taskInstance.findUnique({ where: { id: instanceId } });

  // Members must not be able to learn that another user's instance exists, so
  // an unauthorised id is indistinguishable from a missing one.
  if (!instance || instance.organisationId !== actor.organisationId) {
    throw new TransitionError("Task not found", 404);
  }
  if (actor.role !== Role.ADMIN && instance.assigneeId !== actor.id) {
    throw new TransitionError("Task not found", 404);
  }
  return instance;
}

export async function completeInstance(
  db: DbClient,
  instanceId: string,
  actor: Actor,
  options: { note?: string | null; now?: Date } = {},
) {
  const now = options.now ?? new Date();
  const instance = await loadInstanceFor(db, instanceId, actor);

  if (instance.status === InstanceStatus.COMPLETED) {
    // Idempotent: a double-tap on a flaky phone connection is not an error.
    if (options.note !== undefined && options.note !== instance.note) {
      return db.taskInstance.update({
        where: { id: instance.id },
        data: { note: options.note },
      });
    }
    return instance;
  }

  const isAdmin = actor.role === Role.ADMIN;
  const { graceDays } = await getSettings(db, actor.organisationId);

  if (instance.status === InstanceStatus.MISSED && !isAdmin) {
    throw new TransitionError(
      "This task is past its grace period. Ask an admin to reopen it.",
      403,
    );
  }
  if (
    instance.status === InstanceStatus.PENDING &&
    !isAdmin &&
    !isWithinGraceWindow(instance.dueDate, graceDays)
  ) {
    throw new TransitionError(
      "This task is past its grace period. Ask an admin to reopen it.",
      403,
    );
  }

  // wasLate is the metric with teeth: catching up inside the grace window
  // still counts as completed, but it is permanently recorded as late.
  const wasLate = instance.dueAt ? now.getTime() > instance.dueAt.getTime() : false;

  return atomically(db, async (tx) => {
    const updated = await tx.taskInstance.update({
      where: { id: instance.id },
      data: {
        status: InstanceStatus.COMPLETED,
        completedAt: now,
        completedById: actor.id,
        wasLate,
        ...(options.note !== undefined ? { note: options.note } : {}),
      },
    });
    await tx.auditLog.create({
      data: {
        organisationId: instance.organisationId,
        instanceId: instance.id,
        userId: actor.id,
        fromStatus: instance.status,
        toStatus: InstanceStatus.COMPLETED,
        source: "USER",
      },
    });
    return updated;
  });
}

export async function uncompleteInstance(
  db: DbClient,
  instanceId: string,
  actor: Actor,
) {
  const instance = await loadInstanceFor(db, instanceId, actor);

  if (instance.status !== InstanceStatus.COMPLETED) return instance;

  const isAdmin = actor.role === Role.ADMIN;
  const { graceDays } = await getSettings(db, actor.organisationId);

  if (!isAdmin && !isWithinGraceWindow(instance.dueDate, graceDays)) {
    throw new TransitionError(
      "This task is past its grace period and can no longer be changed.",
      403,
    );
  }

  return atomically(db, async (tx) => {
    const updated = await tx.taskInstance.update({
      where: { id: instance.id },
      data: {
        status: InstanceStatus.PENDING,
        completedAt: null,
        completedById: null,
        wasLate: false,
      },
    });
    await tx.auditLog.create({
      data: {
        organisationId: instance.organisationId,
        instanceId: instance.id,
        userId: actor.id,
        fromStatus: instance.status,
        toStatus: InstanceStatus.PENDING,
        source: "USER",
      },
    });
    return updated;
  });
}

/** Set or clear the free-text note on an instance without changing its status. */
export async function setInstanceNote(
  db: DbClient,
  instanceId: string,
  actor: Actor,
  note: string | null,
) {
  const instance = await loadInstanceFor(db, instanceId, actor);
  return db.taskInstance.update({
    where: { id: instance.id },
    data: { note },
  });
}

/** True when a PENDING instance is past its due date — a display state only. */
export function isOverdue(
  instance: { status: InstanceStatus; dueDate: Date | DateOnly },
  today: DateOnly = todayInLondon(),
): boolean {
  return (
    instance.status === InstanceStatus.PENDING &&
    compareDateOnly(instance.dueDate, today) < 0
  );
}

export function daysLate(dueDate: Date | DateOnly, today: DateOnly = todayInLondon()): number {
  return Math.max(0, daysBetween(dueDate, today));
}
