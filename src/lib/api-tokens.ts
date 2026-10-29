/**
 * Keys that let a machine act in this organisation.
 *
 * Hashed on the way in and never stored in the clear, so a copy of the
 * database is not a copy of the keys. The token is shown once, at the moment
 * it is minted, and cannot be recovered afterwards — which is the only
 * property that makes "it leaked" a question with an answer.
 *
 * Every token carries a user. Nothing an agent does appears from nowhere: a
 * comment it posts has an author, a task it writes off has somebody's name
 * against it. An accountability tool whose record contains anonymous edits is
 * not an accountability tool.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { PrismaClient, Role } from "@prisma/client";

/** Recognisable in a log or a paste, and obviously not a password. */
const PREFIX = "evo_";

export type AgentIdentity = {
  tokenId: string;
  userId: string;
  organisationId: string;
  role: Role;
  /** The token's own label, for saying who did something. */
  name: string;
};

/** 32 random bytes is well past guessing; the prefix is for humans. */
export function generateToken(): string {
  return PREFIX + randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Mint a token for a user, returning the only copy of it there will ever be.
 *
 * The caller is responsible for putting it somewhere safe. Nothing here can
 * show it again.
 */
export async function mintToken(
  db: PrismaClient,
  input: { userId: string; organisationId: string; name: string },
): Promise<{ token: string; id: string }> {
  const token = generateToken();
  const row = await db.apiToken.create({
    data: {
      organisationId: input.organisationId,
      userId: input.userId,
      name: input.name,
      tokenHash: hashToken(token),
    },
    select: { id: true },
  });
  return { token, id: row.id };
}

/**
 * Who a token belongs to, or null.
 *
 * Looked up by hash, so a token that is not in the database costs the same as
 * one that is. The equality check is constant-time out of habit rather than
 * necessity — the lookup is already a hash comparison in the index — because
 * the habit is what survives somebody later replacing the query.
 */
export async function identify(
  db: PrismaClient,
  token: string | null | undefined,
): Promise<AgentIdentity | null> {
  if (!token || !token.startsWith(PREFIX)) return null;

  const hash = hashToken(token);
  const row = await db.apiToken.findUnique({
    where: { tokenHash: hash },
    select: {
      id: true,
      name: true,
      tokenHash: true,
      revokedAt: true,
      organisationId: true,
      user: { select: { id: true, role: true, isActive: true, organisationId: true } },
    },
  });

  if (!row || row.revokedAt) return null;
  if (!equal(row.tokenHash, hash)) return null;

  // A token outlives nothing. Deactivating somebody takes their key with them,
  // the same as it takes their session.
  if (!row.user.isActive) return null;

  // Belt and braces: the token's organisation and its user's must agree, or
  // somebody has edited rows by hand and the safe answer is no.
  if (row.user.organisationId !== row.organisationId) return null;

  return {
    tokenId: row.id,
    userId: row.user.id,
    organisationId: row.organisationId,
    role: row.user.role,
    name: row.name,
  };
}

/** Note that a key is in use, so an unused one can be spotted and revoked. */
export async function touch(db: PrismaClient, tokenId: string): Promise<void> {
  try {
    await db.apiToken.update({
      where: { id: tokenId },
      data: { lastUsedAt: new Date() },
    });
  } catch {
    // A bookkeeping write must never be the reason a request fails.
  }
}

/** The bearer token on a request, if it carries one. */
export function bearerFrom(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const [scheme, value] = header.split(" ");
  if (!scheme || scheme.toLowerCase() !== "bearer" || !value) return null;
  return value.trim();
}

function equal(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
