/**
 * The error type the API layer understands.
 *
 * Deliberately its own module rather than living in lib/guards.ts: the domain
 * services throw these, and importing them should not drag the whole auth
 * stack along behind. errorResponse() reads the `status` off any thrown Error,
 * so this stays in step with guards.ts without depending on it.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
