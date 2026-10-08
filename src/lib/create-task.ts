/**
 * The task hook: the one way another hub module raises work for a person.
 *
 *   createTask(db, { title, assigneeId, due, sourceModule: "finance", sourceRef: "ap-exc-123" })
 *
 * The task is an ordinary one-off, so it lands on the person's day, counts in
 * the reports and is ticked off like anything else. sourceModule and sourceRef
 * tie it back to the item that raised it, and make the call idempotent: while
 * a task for the same item is still open, raising it again returns that one
 * instead of adding a duplicate, so a job can rerun safely.
 */

import { Frequency, InstanceStatus, type PrismaClient } from "@prisma/client";
import { createTemplate } from "./templates";
import { ApiError } from "./errors";
import { maxDateOnly, todayInLondon, type DateOnly } from "./time";

export type CreateTaskInput = {
  title: string;
  description?: string;
  assigneeId: string;
  /** Due date. A date in the past is due today: the work still needs doing. */
  due: DateOnly;
  sourceModule: string;
  sourceRef: string;
  /** Who raised it. Defaults to the assignee, since a job is nobody. */
  raisedById?: string;
};

export async function createTask(db: PrismaClient, input: CreateTaskInput, today: DateOnly = todayInLondon()) {
  const assignee = await db.user.findUnique({
    where: { id: input.assigneeId },
    select: { organisationId: true, isActive: true },
  });
  if (!assignee) throw new ApiError("That person does not exist", 422);
  if (!assignee.isActive) throw new ApiError("That person has been deactivated", 422);

  // Serialise concurrent raises for the same item, then look for an open one.
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${input.sourceModule}:${input.sourceRef}`}))`;
    const existing = await tx.taskTemplate.findFirst({
      where: {
        sourceModule: input.sourceModule,
        sourceRef: input.sourceRef,
        isActive: true,
        instances: { some: { status: InstanceStatus.PENDING } },
      },
    });
    if (existing) return { template: existing, created: false };

    const template = await createTemplate(
      tx as unknown as PrismaClient,
      assignee.organisationId,
      input.raisedById ?? input.assigneeId,
      {
        title: input.title,
        description: input.description,
        assigneeId: input.assigneeId,
        frequency: Frequency.ONE_OFF,
        daysOfWeek: [],
        startDate: maxDateOnly(input.due, today),
        isActive: true,
        isStarred: false,
      },
      today,
    );
    const tagged = await tx.taskTemplate.update({
      where: { id: template.id },
      data: { sourceModule: input.sourceModule, sourceRef: input.sourceRef },
    });
    return { template: tagged, created: true };
  });
}
