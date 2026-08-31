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

export async function currentUser(): Promise<SessionUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return {
    id: session.user.id,
    name: session.user.name ?? "",
    email: session.user.email ?? "",
    role: session.user.role,
    organisationId: session.user.organisationId,
    mustChangePassword: session.user.mustChangePassword,
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
