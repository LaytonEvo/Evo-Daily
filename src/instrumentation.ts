/**
 * Error tracking without a third party: every server-side error Next.js sees
 * — a page that crashed, an API route that threw, a failed server action — is
 * written to app_errors and shown on the Health page, so problems are visible
 * without anyone reporting them. Headers and bodies are never stored.
 */

export async function register() {}

type ErrorRequest = { path: string; method: string };
type ErrorContext = { routerKind: string; routePath: string; routeType: string };

export async function onRequestError(error: unknown, request: ErrorRequest, context: ErrorContext) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { prisma } = await import("./lib/db");
    const err = error instanceof Error ? error : new Error(String(error));
    await prisma.appError.create({
      data: {
        message: err.message.slice(0, 2000),
        digest: (err as Error & { digest?: string }).digest ?? null,
        // The route pattern, not the URL: no ids or query strings in the log.
        path: context.routePath ?? request.path.split("?")[0],
        method: request.method,
        kind: context.routeType,
        stack: err.stack?.slice(0, 8000) ?? null,
      },
    });
  } catch {
    // Recording an error must never cause another one.
  }
}
