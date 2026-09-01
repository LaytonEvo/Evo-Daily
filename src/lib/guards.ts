/**
 * Route and API guards.
 *
 * Two roles only — ADMIN and MEMBER — so this is deliberately three functions
 * and not a permissions matrix.
 */

import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { auth } from "./auth";
import { prisma } from "./db";
import { ApiError } from "./errors";
import type { Actor } from "./instances";

export { ApiError };

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  organisationId: string;
  mustChangePassword: boolean;
};

/**
 * The signed-in user, read fresh.
 *
 * The token supplies identity and nothing else. Every field a guard decides
 * on comes from the database, because a JWT here lives thirty days and its
 * claims are a snapshot of whoever signed in a month ago.
 *
 * Trusting those claims went wrong in all three directions: a deactivated
 * account kept working until its token expired, a change of role waited for
 * the next sign-in, and — the one that stranded people — finishing the forced
 * password change left `mustChangePassword` true in the token, so /my-day
 * bounced them back to the change screen they had just completed, and /login
 * bounced them there too. The only way out was to clear the cookie.
 *
 * The cost is one lookup on a primary key per guarded request, on pages that
 * all query the database anyway.
 */
export async function currentUser(): Promise<SessionUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  const record = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      organisationId: true,
      mustChangePassword: true,
      isActive: true,
    },
  });

  // Deleted or deactivated since the token was issued: treat as signed out.
  if (!record || !record.isActive) return null;

  return {
    id: record.id,
    name: record.name,
    email: record.email,
    role: record.role,
    organisationId: record.organisationId,
    mustChangePassword: record.mustChangePassword,
  };
}

/** For pages: send anonymous visitors to the login screen. */
export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

/** For pages: a MEMBER reaching an /admin route lands back on their own day. */
export async function requireAdminPage(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== Role.ADMIN) redirect("/my-day?denied=admin");
  return user;
}

/** For API routes: 401 when signed out. */
export async function requireApiUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) throw new ApiError("Not signed in", 401);
  return user;
}

/** For API routes: 403 when a MEMBER reaches an admin endpoint. */
export async function requireApiAdmin(): Promise<SessionUser> {
  const user = await requireApiUser();
  if (user.role !== Role.ADMIN) throw new ApiError("Admins only", 403);
  return user;
}

export function toActor(user: SessionUser): Actor {
  return { id: user.id, role: user.role, organisationId: user.organisationId };
}

/**
 * Turn a thrown error into its JSON response.
 *
 * Duck-typed on `status` rather than on a class, so every error carrying an
 * intended HTTP status — ApiError, TransitionError, CronAuthError — maps to it,
 * including across module boundaries where `instanceof` cannot be relied on.
 */
export function errorResponse(error: unknown): NextResponse {
  if (error instanceof Error && error.name === "ZodError") {
    return NextResponse.json({ error: "Invalid request" }, { status: 422 });
  }

  const status = statusOf(error);
  if (status !== null) {
    return NextResponse.json({ error: (error as Error).message }, { status });
  }

  console.error("Unhandled API error", error);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/** A caller-intended HTTP status, if the error carries a sensible one. */
function statusOf(error: unknown): number | null {
  if (!(error instanceof Error)) return null;
  const status = (error as Error & { status?: unknown }).status;
  if (typeof status !== "number" || status < 400 || status > 599) return null;
  return status;
}
