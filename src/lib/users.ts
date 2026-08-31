/**
 * User management. Admins create accounts — there is no self-registration.
 */

import { Role, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { hashPassword, MIN_PASSWORD_LENGTH } from "./password";
import { ApiError } from "./errors";

export const createUserSchema = z.object({
  name: z.string().trim().min(1, "Give them a name").max(120),
  email: z.string().trim().toLowerCase().email("That is not a valid email"),
  password: z.string().min(MIN_PASSWORD_LENGTH),
  role: z.nativeEnum(Role).default(Role.MEMBER),
  slackUserId: z.string().trim().max(64).nullish(),
  managerId: z.string().nullish(),
});

export const updateUserSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  role: z.nativeEnum(Role).optional(),
  isActive: z.boolean().optional(),
  slackUserId: z.string().trim().max(64).nullish(),
  managerId: z.string().nullish(),
  /** Set by an admin; the user is then forced to change it on next sign-in. */
  password: z.string().min(MIN_PASSWORD_LENGTH).optional(),
});

/**
 * Reject a reporting line that loops back on itself.
 *
 * Checking only for self-reference is not enough: A reporting to B and B
 * reporting to A is just as circular, and any code that walks the chain — the
 * miss alerts today, a manager team-view later — would spin on it forever.
 *
 * Walks up from the proposed manager. Reaching `userId` means the assignment
 * would close a loop; reaching anyone already seen means the existing data
 * holds one. Both are rejected, and the `seen` set guarantees the walk
 * terminates however broken the stored chain is.
 */
async function assertNoManagerCycle(
  db: PrismaClient,
  organisationId: string,
  userId: string,
  managerId: string,
): Promise<void> {
  if (managerId === userId) {
    throw new ApiError("Someone cannot be their own manager", 422);
  }

  const seen = new Set<string>([userId]);
  let cursor: string | null = managerId;

  while (cursor) {
    if (seen.has(cursor)) {
      throw new ApiError(
        "That would put two people in each other's reporting line.",
        422,
      );
    }
    seen.add(cursor);

    // Scoped to the organisation, so a manager from another one is rejected
    // rather than silently ending the walk.
    const next: { managerId: string | null } | null = await db.user.findFirst({
      where: { id: cursor, organisationId },
      select: { managerId: true },
    });
    if (!next) throw new ApiError("That person is not in this organisation", 422);

    cursor = next.managerId;
  }
}

export async function createUser(
  db: PrismaClient,
  organisationId: string,
  input: z.infer<typeof createUserSchema>,
) {
  const existing = await db.user.findUnique({ where: { email: input.email } });
  if (existing) throw new ApiError("Someone already uses that email", 409);

  // Nobody reports to an account that does not exist yet, so a new user cannot
  // close a loop — but their manager still has to be a real colleague.
  if (input.managerId) {
    const manager = await db.user.findFirst({
      where: { id: input.managerId, organisationId },
      select: { id: true },
    });
    if (!manager) throw new ApiError("That person is not in this organisation", 422);
  }

  return db.user.create({
    data: {
      organisationId,
      name: input.name,
      email: input.email,
      passwordHash: await hashPassword(input.password),
      role: input.role,
      slackUserId: input.slackUserId || null,
      managerId: input.managerId || null,
      mustChangePassword: true,
    },
  });
}

export async function updateUser(
  db: PrismaClient,
  organisationId: string,
  actingUserId: string,
  userId: string,
  input: z.infer<typeof updateUserSchema>,
) {
  const user = await db.user.findFirst({ where: { id: userId, organisationId } });
  if (!user) throw new ApiError("User not found", 404);

  // An admin locking themselves out, or demoting themselves to a member, is a
  // support call nobody wants at 8am.
  if (userId === actingUserId) {
    if (input.isActive === false) {
      throw new ApiError("You cannot deactivate your own account", 400);
    }
    if (input.role && input.role !== Role.ADMIN) {
      throw new ApiError("You cannot remove your own admin access", 400);
    }
  }

  if (input.managerId) {
    await assertNoManagerCycle(db, organisationId, userId, input.managerId);
  }

  return db.user.update({
    where: { id: userId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.role !== undefined ? { role: input.role } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(input.slackUserId !== undefined ? { slackUserId: input.slackUserId || null } : {}),
      ...(input.managerId !== undefined ? { managerId: input.managerId || null } : {}),
      ...(input.password
        ? { passwordHash: await hashPassword(input.password), mustChangePassword: true }
        : {}),
    },
  });
}
