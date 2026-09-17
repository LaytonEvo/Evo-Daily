/**
 * Holidays, and what happens to the work while someone is away.
 *
 * Two outcomes, chosen per absence:
 *
 *   cover set   — the period's tasks move to the cover person and count
 *                 against them as normal. Real work, really owed.
 *   no cover    — the tasks become EXCUSED. Still on the record, so you can
 *                 see what went uncovered when planning next time, but out of
 *                 the completion rate entirely. A fortnight off must not read
 *                 as a fortnight of failure.
 *
 * Applied at two moments: when an absence is saved (to instances that already
 * exist, since generation runs a fortnight ahead) and during generation (for
 * days not yet reached). Both go through applyAbsence, so there is one rule.
 */

import { InstanceStatus, Role, type Prisma, type PrismaClient } from "@prisma/client";
import { ApiError } from "./errors";
import { compareDateOnly, toDateOnly, toDbDate, todayInLondon, type DateOnly } from "./time";

type DbClient = PrismaClient | Prisma.TransactionClient;

export type AbsenceInput = {
  userId: string;
  from: DateOnly;
  to: DateOnly;
  reason?: string | null;
  coverUserId?: string | null;
};

function assertAdmin(actor: { role: Role }) {
  if (actor.role !== Role.ADMIN) {
    throw new ApiError("Only an admin can record time off", 403);
  }
}

async function validate(
  db: DbClient,
  organisationId: string,
  input: AbsenceInput,
  ignoreId?: string,
) {
  if (compareDateOnly(input.from, input.to) > 0) {
    throw new ApiError("The last day cannot be before the first", 422);
  }

  const person = await db.user.findFirst({
    where: { id: input.userId, organisationId },
    select: { id: true },
  });
  if (!person) throw new ApiError("That person is not in this workspace", 404);

  if (input.coverUserId) {
    if (input.coverUserId === input.userId) {
      throw new ApiError("Someone cannot cover their own time off", 422);
    }
    const cover = await db.user.findFirst({
      where: { id: input.coverUserId, organisationId, isActive: true },
      select: { id: true },
    });
    if (!cover) throw new ApiError("That cover person is not available", 404);
  }

  // Overlapping absences for one person would fight over the same instances,
  // and the winner would depend on which was applied last.
  const clash = await db.absence.findFirst({
    where: {
      userId: input.userId,
      ...(ignoreId ? { id: { not: ignoreId } } : {}),
      from: { lte: toDbDate(input.to) },
      to: { gte: toDbDate(input.from) },
    },
    select: { id: true },
  });
  if (clash) throw new ApiError("That overlaps time off already recorded", 409);
}

export async function listAbsences(db: DbClient, organisationId: string) {
  return db.absence.findMany({
    where: { organisationId },
    orderBy: { from: "desc" },
    include: {
      user: { select: { id: true, name: true } },
      cover: { select: { id: true, name: true } },
    },
  });
}

export async function createAbsence(
  db: DbClient,
  actor: { id: string; role: Role; organisationId: string },
  input: AbsenceInput,
) {
  assertAdmin(actor);
  await validate(db, actor.organisationId, input);

  const absence = await db.absence.create({
    data: {
      organisationId: actor.organisationId,
      userId: input.userId,
      from: toDbDate(input.from),
      to: toDbDate(input.to),
      reason: input.reason?.trim() || null,
      coverUserId: input.coverUserId ?? null,
      createdById: actor.id,
    },
  });

  const applied = await applyAbsence(db, absence.id);
  return { absence, applied };
}

export async function deleteAbsence(
  db: DbClient,
  actor: { id: string; role: Role; organisationId: string },
  id: string,
) {
  assertAdmin(actor);
  const absence = await db.absence.findFirst({
    where: { id, organisationId: actor.organisationId },
  });
  if (!absence) throw new ApiError("Time off not found", 404);

  // Put back anything still untouched. A task already ticked stays ticked —
  // someone did it, and rewriting that would be a lie.
  const restored = await db.taskInstance.updateMany({
    where: {
      organisationId: absence.organisationId,
      assigneeId: absence.userId,
      status: InstanceStatus.EXCUSED,
      dueDate: { gte: absence.from, lte: absence.to },
    },
    data: { status: InstanceStatus.PENDING },
  });

  await db.absence.delete({ where: { id } });
  return { restored: restored.count };
}

/**
 * Bring existing instances into line with one absence.
 *
 * Only touches work still outstanding. A task the person completed before
 * going away is theirs, and a task already missed stays missed — backdating an
 * excuse onto a miss is exactly the kind of edit that makes a leaderboard
 * arguable.
 */
export async function applyAbsence(
  db: DbClient,
  absenceId: string,
): Promise<{ covered: number; excused: number }> {
  const absence = await db.absence.findUnique({ where: { id: absenceId } });
  if (!absence) return { covered: 0, excused: 0 };

  const window = {
    organisationId: absence.organisationId,
    assigneeId: absence.userId,
    status: InstanceStatus.PENDING,
    dueDate: { gte: absence.from, lte: absence.to },
  };

  if (absence.coverUserId) {
    const moved = await db.taskInstance.updateMany({
      where: window,
      // assigneeId is a snapshot field, deliberately frozen at generation.
      // This is the one sanctioned exception: the work genuinely changes hands,
      // and the alternative is holding someone to a task they cannot do.
      data: { assigneeId: absence.coverUserId },
    });
    return { covered: moved.count, excused: 0 };
  }

  const excused = await db.taskInstance.updateMany({
    where: window,
    data: { status: InstanceStatus.EXCUSED },
  });
  return { covered: 0, excused: excused.count };
}

/** Absences covering a date, for the generator. */
export async function absencesOn(
  db: DbClient,
  organisationId: string,
  date: DateOnly,
): Promise<Map<string, { coverUserId: string | null }>> {
  const rows = await db.absence.findMany({
    where: {
      organisationId,
      from: { lte: toDbDate(date) },
      to: { gte: toDbDate(date) },
    },
    select: { userId: true, coverUserId: true },
  });
  return new Map(rows.map((r) => [r.userId, { coverUserId: r.coverUserId }]));
}

/** Everyone away today, for the admin screen. */
export async function awayToday(
  db: DbClient,
  organisationId: string,
  today: DateOnly = todayInLondon(),
) {
  return db.absence.findMany({
    where: {
      organisationId,
      from: { lte: toDbDate(today) },
      to: { gte: toDbDate(today) },
    },
    include: {
      user: { select: { id: true, name: true } },
      cover: { select: { id: true, name: true } },
    },
  });
}

export function absenceDays(from: Date, to: Date): number {
  const a = toDateOnly(from);
  const b = toDateOnly(to);
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) + 1;
}
