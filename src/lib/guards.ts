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
import type { Actor } from "./instances";

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

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
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

/** Turn a thrown ApiError/TransitionError into its JSON response. */
export function errorResponse(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name: string }).name === "TransitionError"
  ) {
    const e = error as unknown as { message: string; status?: number };
    return NextResponse.json({ error: e.message }, { status: e.status ?? 400 });
  }
  if (error instanceof Error && error.name === "ZodError") {
    return NextResponse.json({ error: "Invalid request" }, { status: 422 });
  }
  console.error("Unhandled API error", error);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/**
 * Guard for the cron endpoints. A request without a matching secret is
 * rejected outright — these endpoints mutate everyone's data.
 */
export function assertCronSecret(request: Request): void {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    throw new ApiError("Cron is not configured", 500);
  }
  const provided = request.headers.get("x-cron-secret");
  if (!provided || !timingSafeEqual(provided, expected)) {
    throw new ApiError("Unauthorised", 401);
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
