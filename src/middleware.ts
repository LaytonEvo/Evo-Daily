import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * A cheap first gate: anyone without a session cookie is bounced to /login
 * before a page renders. The authoritative checks are still the server-side
 * guards in lib/guards.ts — this only saves a wasted render.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const hasSession =
    request.cookies.has("authjs.session-token") ||
    request.cookies.has("__Secure-authjs.session-token");

  if (!hasSession) {
    const login = new URL("/login", request.url);
    if (pathname !== "/") login.searchParams.set("from", pathname);
    return NextResponse.redirect(login);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/my-day/:path*", "/admin/:path*", "/change-password"],
};
