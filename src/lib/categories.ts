/**
 * Category management.
 *
 * Categories group tasks and drive the "which area of the business is
 * slipping" panel. Two rules shape everything here:
 *
 *  - Renaming applies retroactively, on purpose. Instances store the category
 *    id, not its name, so a rename relabels history too — which is what a
 *    rename should do. Reassigning a task is the case where history is frozen;
 *    this is not that case.
 *
 *  - A category in use is retired, never deleted. Templates and instances hold
 *    a reference to it, so deleting one would either fail or strand history
 *    under a name nothing can resolve. One that nothing references yet — a
 *    typo, a change of mind — can be removed outright.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { ApiError } from "./errors";

export const categoryInputSchema = z.object({
  name: z.string().trim().min(1, "Give the category a name").max(60),
  colour: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #2563eb"),
  sortOrder: z.number().int().min(0).max(999).optional(),
});

export const categoryUpdateSchema = z.object({
  name: z.string().trim().min(1, "Give the category a name").max(60).optional(),
  colour: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #2563eb")
    .optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
  isActive: z.boolean().optional(),
});

/** Prisma's unique-constraint code, raised by the (organisation, name) index. */
function isDuplicateName(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

export async function createCategory(
  db: PrismaClient,
  organisationId: string,
  input: z.infer<typeof categoryInputSchema>,
) {
  // Append to the end unless a position is given, so a new one does not
  // silently jump the list.
  const sortOrder =
    input.sortOrder ??
    ((await db.category.aggregate({
      where: { organisationId },
      _max: { sortOrder: true },
    }))._max.sortOrder ?? 0) + 1;

  try {
    return await db.category.create({
      data: { organisationId, name: input.name, colour: input.colour, sortOrder },
    });
  } catch (error) {
    if (isDuplicateName(error)) {
      throw new ApiError(`There is already a category called "${input.name}"`, 409);
    }
    throw error;
  }
}

export async function updateCategory(
  db: PrismaClient,
  organisationId: string,
  categoryId: string,
  input: z.infer<typeof categoryUpdateSchema>,
) {
  const existing = await db.category.findFirst({
    where: { id: categoryId, organisationId },
    select: { id: true },
  });
  if (!existing) throw new ApiError("Category not found", 404);

  try {
    return await db.category.update({
      where: { id: categoryId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.colour !== undefined ? { colour: input.colour } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });
  } catch (error) {
    if (isDuplicateName(error)) {
      throw new ApiError(`There is already a category called "${input.name}"`, 409);
    }
    throw error;
  }
}

export type CategoryUsage = { templates: number; instances: number };

export async function categoryUsage(
  db: PrismaClient | Prisma.TransactionClient,
  categoryId: string,
): Promise<CategoryUsage> {
  const [templates, instances] = await Promise.all([
    db.taskTemplate.count({ where: { categoryId } }),
    db.taskInstance.count({ where: { categoryId } }),
  ]);
  return { templates, instances };
}

/**
 * Remove a category outright, but only while nothing points at it. Anything in
 * use must be retired with `isActive: false` instead — the error says so.
 */
export async function deleteCategory(
  db: PrismaClient,
  organisationId: string,
  categoryId: string,
) {
  const existing = await db.category.findFirst({
    where: { id: categoryId, organisationId },
    select: { id: true, name: true },
  });
  if (!existing) throw new ApiError("Category not found", 404);

  const usage = await categoryUsage(db, categoryId);
  if (usage.templates > 0 || usage.instances > 0) {
    throw new ApiError(
      `"${existing.name}" is used by ${describeUsage(usage)}. Turn it off instead — ` +
        `it will disappear from the task form, and past reports will still read correctly.`,
      409,
    );
  }

  await db.category.delete({ where: { id: categoryId } });
  return existing;
}

function describeUsage({ templates, instances }: CategoryUsage): string {
  const parts: string[] = [];
  if (templates > 0) parts.push(`${templates} task${templates === 1 ? "" : "s"}`);
  if (instances > 0) {
    parts.push(`${instances} recorded instance${instances === 1 ? "" : "s"}`);
  }
  return parts.join(" and ");
}
