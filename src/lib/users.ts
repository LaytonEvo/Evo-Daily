/**
 * User management. Admins create accounts — there is no self-registration.
 */

import { Role, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { hashPassword, MIN_PASSWORD_LENGTH } from "./auth";
import { ApiError } from "./guards";

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

export async function createUser(
  db: PrismaClient,
  organisationId: string,
  input: z.infer<typeof createUserSchema>,
) {
  const existing = await db.user.findUnique({ where: { email: input.email } });
  if (existing) throw new ApiError("Someone already uses that email", 409);

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

  if (input.managerId && input.managerId === userId) {
    throw new ApiError("Someone cannot be their own manager", 422);
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
