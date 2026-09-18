/**
 * Task template management.
 *
 * The editing rules live here, not in the route handlers, so every path —
 * the drawer, a bulk reassign, a duplicate — obeys them identically:
 *
 *  - Editing changes future instances only. PENDING instances dated after
 *    today are rebuilt; anything due today or earlier keeps the title and
 *    category it was generated with. The one exception is the owner: today's
 *    instance follows a reassignment, because nobody has done it yet and
 *    leaving it behind just makes two screens disagree.
 *  - Deactivating drops future PENDING instances and leaves history intact.
 *  - Deleting is only for a task nothing has happened to yet. Anything with a
 *    record is deactivated instead, so no report is ever rewritten.
 */

import { Frequency, InstanceStatus, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  DEFAULT_DAYS_OF_WEEK,
  generateInstances,
  realignTodayToOwner,
  regenerateFutureInstances,
  removeFutureInstances,
} from "./recurrence";
import { getSettings } from "./settings";
import { addDays, isTimeOfDay, toDateOnly, toDbDate, todayInLondon, type DateOnly } from "./time";
import { ApiError } from "./errors";

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const templateInputSchema = z
  .object({
    title: z.string().trim().min(1, "Give the task a title").max(200),
    description: z.string().trim().max(2000).nullish(),
    categoryId: z.string().nullish(),
    assigneeId: z.string().min(1, "Pick who owns this"),
    frequency: z.nativeEnum(Frequency),
    daysOfWeek: z.array(z.number().int().min(1).max(7)).default([]),
    dayOfWeek: z.number().int().min(1).max(7).nullish(),
    dayOfMonth: z.number().int().min(1).max(31).nullish(),
    dueTime: z
      .string()
      .refine((v) => v === "" || isTimeOfDay(v), "Use HH:mm")
      .nullish(),
    startDate: dateOnly,
    endDate: dateOnly.nullish(),
    isActive: z.boolean().default(true),
  })
  .superRefine((value, ctx) => {
    if (value.frequency === Frequency.DAILY && value.daysOfWeek.length === 0) {
      // Not an error — an empty list means the Mon–Fri default.
      return;
    }
    if (value.frequency === Frequency.WEEKLY && !value.dayOfWeek) {
      ctx.addIssue({ code: "custom", path: ["dayOfWeek"], message: "Pick a day of the week" });
    }
    if (value.frequency === Frequency.MONTHLY && !value.dayOfMonth) {
      ctx.addIssue({ code: "custom", path: ["dayOfMonth"], message: "Pick a day of the month" });
    }
    if (value.endDate && value.endDate < value.startDate) {
      ctx.addIssue({ code: "custom", path: ["endDate"], message: "End date is before the start date" });
    }
  });

export type TemplateInput = z.infer<typeof templateInputSchema>;

/** Normalise the schedule fields so only the ones this frequency uses are set. */
function scheduleFieldsFor(input: TemplateInput) {
  return {
    daysOfWeek:
      input.frequency === Frequency.DAILY
        ? input.daysOfWeek.length > 0
          ? [...new Set(input.daysOfWeek)].sort((a, b) => a - b)
          : DEFAULT_DAYS_OF_WEEK
        : [],
    dayOfWeek: input.frequency === Frequency.WEEKLY ? (input.dayOfWeek ?? null) : null,
    dayOfMonth: input.frequency === Frequency.MONTHLY ? (input.dayOfMonth ?? null) : null,
    // A one-off ends the day it happens; leaving it open would be misleading.
    endDate:
      input.frequency === Frequency.ONE_OFF
        ? toDbDate(input.startDate)
        : input.endDate
          ? toDbDate(input.endDate)
          : null,
  };
}

async function assertBelongsToOrg(
  db: PrismaClient,
  organisationId: string,
  input: Pick<TemplateInput, "assigneeId" | "categoryId">,
): Promise<void> {
  const assignee = await db.user.findFirst({
    where: { id: input.assigneeId, organisationId },
    select: { id: true },
  });
  if (!assignee) throw new ApiError("That person is not in this organisation", 422);

  if (input.categoryId) {
    const category = await db.category.findFirst({
      where: { id: input.categoryId, organisationId },
      select: { id: true },
    });
    if (!category) throw new ApiError("That category does not exist", 422);
  }
}

export async function createTemplate(
  db: PrismaClient,
  organisationId: string,
  createdById: string,
  input: TemplateInput,
  today: DateOnly = todayInLondon(),
) {
  await assertBelongsToOrg(db, organisationId, input);
  const { generationHorizonDays } = await getSettings(db, organisationId);

  const template = await db.taskTemplate.create({
    data: {
      organisationId,
      createdById,
      title: input.title,
      description: input.description?.trim() || null,
      categoryId: input.categoryId || null,
      assigneeId: input.assigneeId,
      frequency: input.frequency,
      dueTime: input.dueTime || null,
      startDate: toDbDate(input.startDate),
      isActive: input.isActive,
      ...scheduleFieldsFor(input),
    },
  });

  // Fill the horizon straight away, starting today, so a task created this
  // morning and due this morning lands on the assignee's day now rather than
  // after tonight's cron.
  if (template.isActive) {
    await generateInstances(db, today, addDays(today, generationHorizonDays), {
      templateIds: [template.id],
    });
  }

  return template;
}

export async function updateTemplate(
  db: PrismaClient,
  organisationId: string,
  templateId: string,
  input: TemplateInput,
  today: DateOnly = todayInLondon(),
) {
  const existing = await db.taskTemplate.findFirst({
    where: { id: templateId, organisationId },
  });
  if (!existing) throw new ApiError("Task not found", 404);

  await assertBelongsToOrg(db, organisationId, input);
  const { generationHorizonDays } = await getSettings(db, organisationId);

  const template = await db.taskTemplate.update({
    where: { id: templateId },
    data: {
      title: input.title,
      description: input.description?.trim() || null,
      categoryId: input.categoryId || null,
      assigneeId: input.assigneeId,
      frequency: input.frequency,
      dueTime: input.dueTime || null,
      startDate: toDbDate(input.startDate),
      isActive: input.isActive,
      ...scheduleFieldsFor(input),
    },
  });

  // Editing changes the future only. Today's instance and all history keep the
  // title and category they were generated with.
  if (template.isActive) {
    await regenerateFutureInstances(db, template.id, today, generationHorizonDays);
  } else {
    await removeFutureInstances(db, template.id, today);
  }

  // The owner is the exception: an open task due today belongs to whoever owns
  // it now, not whoever owned it this morning.
  await realignTodayToOwner(db, template.id, template.assigneeId, today);

  return template;
}

export async function setTemplateActive(
  db: PrismaClient,
  organisationId: string,
  templateId: string,
  isActive: boolean,
  today: DateOnly = todayInLondon(),
) {
  const existing = await db.taskTemplate.findFirst({
    where: { id: templateId, organisationId },
    select: { id: true },
  });
  if (!existing) throw new ApiError("Task not found", 404);

  const { generationHorizonDays } = await getSettings(db, organisationId);
  const template = await db.taskTemplate.update({
    where: { id: templateId },
    data: { isActive },
  });

  if (isActive) {
    await regenerateFutureInstances(db, templateId, today, generationHorizonDays);
  } else {
    // History is left completely intact — only unstarted future work goes.
    await removeFutureInstances(db, templateId, today);
  }

  return template;
}

/**
 * Remove a task outright, but only while nothing has happened to it. A task
 * that has ever been completed, missed, excused or commented on is a record,
 * and deleting it would quietly rewrite every report that counted it — a
 * completion rate that changes when someone tidies up is not a completion
 * rate. Those are deactivated instead, and the error says so.
 *
 * Unstarted future instances are not a record and go with it, along with the
 * cover rows on any booked absence. This is the accidental duplicate, the
 * draft, the task typed in twice.
 */
export async function deleteTemplate(
  db: PrismaClient,
  organisationId: string,
  templateId: string,
) {
  const existing = await db.taskTemplate.findFirst({
    where: { id: templateId, organisationId },
    select: { id: true, title: true },
  });
  if (!existing) throw new ApiError("Task not found", 404);

  const [recorded, comments] = await Promise.all([
    db.taskInstance.count({
      where: { templateId, status: { not: InstanceStatus.PENDING } },
    }),
    db.comment.count({ where: { instance: { templateId } } }),
  ]);

  if (recorded > 0 || comments > 0) {
    throw new ApiError(
      `"${existing.title}" has ${describeRecord(recorded, comments)}. Turn it off instead — ` +
        `it will stop generating, and past reports will still read correctly.`,
      409,
    );
  }

  // Audit rows and comment rows cascade from the instances; absence cover rows
  // cascade from the template itself.
  await db.taskInstance.deleteMany({ where: { templateId } });
  await db.taskTemplate.delete({ where: { id: templateId } });
  return existing;
}

function describeRecord(recorded: number, comments: number): string {
  const parts: string[] = [];
  if (recorded > 0) parts.push(`${recorded} day${recorded === 1 ? "" : "s"} on the record`);
  if (comments > 0) parts.push(`${comments} comment${comments === 1 ? "" : "s"}`);
  return parts.join(" and ");
}

export async function duplicateTemplate(
  db: PrismaClient,
  organisationId: string,
  templateId: string,
  createdById: string,
  today: DateOnly = todayInLondon(),
) {
  const source = await db.taskTemplate.findFirst({
    where: { id: templateId, organisationId },
  });
  if (!source) throw new ApiError("Task not found", 404);

  const copy = await db.taskTemplate.create({
    data: {
      organisationId,
      createdById,
      title: `${source.title} (copy)`,
      description: source.description,
      categoryId: source.categoryId,
      assigneeId: source.assigneeId,
      frequency: source.frequency,
      daysOfWeek: source.daysOfWeek,
      dayOfWeek: source.dayOfWeek,
      dayOfMonth: source.dayOfMonth,
      dueTime: source.dueTime,
      // A copy starts today, not on the original's start date — nobody wants
      // a duplicate that back-fills six months of history.
      startDate: toDbDate(today),
      endDate: source.endDate,
      isActive: false,
    },
  });

  // Deliberately created inactive: a duplicate is a starting point to edit,
  // not live work someone is suddenly accountable for.
  return copy;
}

/**
 * Bulk reassign. Future instances and today's still-open one; history stays
 * exactly where it is, so the split between people never changes retroactively.
 */
export async function reassignTemplates(
  db: PrismaClient,
  organisationId: string,
  templateIds: string[],
  assigneeId: string,
  today: DateOnly = todayInLondon(),
): Promise<number> {
  const assignee = await db.user.findFirst({
    where: { id: assigneeId, organisationId },
    select: { id: true },
  });
  if (!assignee) throw new ApiError("That person is not in this organisation", 422);

  const templates = await db.taskTemplate.findMany({
    where: { id: { in: templateIds }, organisationId },
    select: { id: true, isActive: true },
  });
  const { generationHorizonDays } = await getSettings(db, organisationId);

  for (const template of templates) {
    await db.taskTemplate.update({
      where: { id: template.id },
      data: { assigneeId },
    });
    if (template.isActive) {
      await regenerateFutureInstances(db, template.id, today, generationHorizonDays);
    }
    await realignTodayToOwner(db, template.id, assigneeId, today);
  }

  return templates.length;
}

/**
 * The fields a bulk edit may change.
 *
 * Every one is optional and absence means "leave it alone" — the whole point
 * of editing nineteen tasks at once is to change the one thing that is wrong
 * with all of them, not to overwrite eighteen fields with whatever the form
 * happened to be showing. `null` is a value here and means clear it, which is
 * why these are read with `in` rather than `??`.
 *
 * Title and description are deliberately absent: they are the fields that make
 * one task different from another, and setting them in bulk produces nineteen
 * tasks nobody can tell apart.
 */
export const bulkChangesSchema = z
  .object({
    assigneeId: z.string().min(1).optional(),
    categoryId: z.string().nullable().optional(),
    frequency: z.nativeEnum(Frequency).optional(),
    daysOfWeek: z.array(z.number().int().min(1).max(7)).optional(),
    dayOfWeek: z.number().int().min(1).max(7).nullable().optional(),
    dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
    dueTime: z
      .string()
      .refine((v) => v === "" || isTimeOfDay(v), "Use HH:mm")
      .nullable()
      .optional(),
    startDate: dateOnly.optional(),
    endDate: dateOnly.nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Choose at least one thing to change");

export type BulkChanges = z.infer<typeof bulkChangesSchema>;

export type BulkResult = { updated: number };

/**
 * Apply one set of changes to many tasks.
 *
 * Each task is merged with the changes and then put through the *same*
 * validation and the same update path as a single edit, so a bulk change
 * cannot produce a task the drawer would have refused — a monthly task with
 * no day of the month, an end date before its start. That matters more here
 * than anywhere: one bad submission would otherwise corrupt every task at
 * once, and the schedule is what generates tomorrow's work.
 *
 * Validation runs over all of them before anything is written. A partial bulk
 * edit is worse than a rejected one, because the half that changed and the
 * half that did not look identical in the list afterwards.
 */
export async function updateTemplates(
  db: PrismaClient,
  organisationId: string,
  templateIds: string[],
  changes: BulkChanges,
  today: DateOnly = todayInLondon(),
): Promise<BulkResult> {
  const templates = await db.taskTemplate.findMany({
    where: { id: { in: templateIds }, organisationId },
  });
  if (templates.length === 0) return { updated: 0 };

  // A frequency needs the field that frequency is scheduled by, and the tasks
  // being changed cannot supply it — they are on a different frequency, which
  // is the reason for the edit. Caught here so the message names the cause
  // rather than repeating a per-task complaint nineteen times.
  if (changes.frequency === Frequency.WEEKLY && !changes.dayOfWeek) {
    throw new ApiError("Moving these to weekly needs a day of the week", 422);
  }
  if (changes.frequency === Frequency.MONTHLY && !changes.dayOfMonth) {
    throw new ApiError("Moving these to monthly needs a day of the month", 422);
  }

  const merged = templates.map((template) => ({
    id: template.id,
    input: mergeChanges(template, changes),
  }));

  // Pass one: everything, or nothing.
  for (const { input } of merged) {
    const parsed = templateInputSchema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new ApiError(`${input.title}: ${issue?.message ?? "Invalid change"}`, 422);
    }
  }

  // Pass two: the ordinary single-task path, once each. Slower than one
  // updateMany, and the only way the regeneration, the grace rules and the
  // owner realignment stay identical to a single edit rather than a second
  // implementation of them that drifts.
  for (const { id, input } of merged) {
    await updateTemplate(db, organisationId, id, templateInputSchema.parse(input), today);
  }

  return { updated: merged.length };
}

type ExistingTemplate = {
  title: string;
  description: string | null;
  categoryId: string | null;
  assigneeId: string;
  frequency: Frequency;
  daysOfWeek: number[];
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  dueTime: string | null;
  startDate: Date;
  endDate: Date | null;
  isActive: boolean;
};

/** Existing values, overlaid with whatever the edit actually named. */
function mergeChanges(template: ExistingTemplate, changes: BulkChanges) {
  return {
    title: template.title,
    description: template.description,
    categoryId: "categoryId" in changes ? changes.categoryId : template.categoryId,
    assigneeId: changes.assigneeId ?? template.assigneeId,
    frequency: changes.frequency ?? template.frequency,
    daysOfWeek: changes.daysOfWeek ?? template.daysOfWeek,
    dayOfWeek: "dayOfWeek" in changes ? changes.dayOfWeek : template.dayOfWeek,
    dayOfMonth: "dayOfMonth" in changes ? changes.dayOfMonth : template.dayOfMonth,
    dueTime: "dueTime" in changes ? changes.dueTime : template.dueTime,
    startDate: changes.startDate ?? toDateOnly(template.startDate),
    endDate:
      "endDate" in changes
        ? changes.endDate
        : template.endDate
          ? toDateOnly(template.endDate)
          : null,
    isActive: changes.isActive ?? template.isActive,
  };
}
