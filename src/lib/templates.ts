/**
 * Task template management.
 *
 * The editing rules live here, not in the route handlers, so every path —
 * the drawer, a bulk reassign, a duplicate — obeys them identically:
 *
 *  - Editing changes future instances only. PENDING instances dated after
 *    today are rebuilt; anything due today or earlier is never touched.
 *  - Deactivating drops future PENDING instances and leaves history intact.
 *  - Templates are never hard-deleted.
 */

import { Frequency, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  DEFAULT_DAYS_OF_WEEK,
  generateInstances,
  regenerateFutureInstances,
  removeFutureInstances,
} from "./recurrence";
import { getSettings } from "./settings";
import { addDays, isTimeOfDay, toDbDate, todayInLondon, type DateOnly } from "./time";
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

  // Editing changes the future only. Today's instances and all history keep
  // the title, assignee and category they were generated with.
  if (template.isActive) {
    await regenerateFutureInstances(db, template.id, today, generationHorizonDays);
  } else {
    await removeFutureInstances(db, template.id, today);
  }

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

/** Bulk reassign. Future instances only — the historical split stays correct. */
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
  }

  return templates.length;
}
