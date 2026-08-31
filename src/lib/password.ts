/**
 * Password hashing and the length rule.
 *
 * Kept apart from lib/auth.ts so the domain services can hash a password
 * without importing the whole NextAuth setup — bcrypt has no business
 * pulling in the request-handling stack.
 */

import bcrypt from "bcryptjs";

export const PASSWORD_SALT_ROUNDS = 10;
export const MIN_PASSWORD_LENGTH = 10;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, PASSWORD_SALT_ROUNDS);
}
