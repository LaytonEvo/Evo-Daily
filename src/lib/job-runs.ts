/**
 * The hub's activity log: every background job run, success or failure.
 *
 * A run is written when it starts and finished when it ends, so a job that
 * dies half way still shows up — as RUNNING with no finish time — instead of
 * leaving no trace at all.
 */

import { JobRunStatus, Prisma, type PrismaClient } from "@prisma/client";

export type JobTrigger = "schedule" | "manual" | "test";

export type JobOutcome = {
  /** Ran, but something looks off: a count mismatch, an empty result. */
  warning?: string;
  message?: string;
  details?: Record<string, unknown>;
};

export async function runJob<T extends JobOutcome>(
  db: PrismaClient,
  job: { module: string; name: string; trigger: JobTrigger },
  fn: () => Promise<T>,
): Promise<T> {
  const run = await db.jobRun.create({
    data: { module: job.module, jobName: job.name, trigger: job.trigger },
  });

  try {
    const outcome = await fn();
    await db.jobRun.update({
      where: { id: run.id },
      data: {
        status: outcome.warning ? JobRunStatus.WARNING : JobRunStatus.SUCCESS,
        message: outcome.warning ?? outcome.message ?? null,
        details: toJson(outcome.details),
        finishedAt: new Date(),
      },
    });
    return outcome;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    await db.jobRun.update({
      where: { id: run.id },
      data: {
        status: JobRunStatus.FAILED,
        message: err.message,
        details: toJson({ error: err.message, stack: err.stack }),
        finishedAt: new Date(),
      },
    });
    throw err;
  }
}

function toJson(value: Record<string, unknown> | undefined) {
  // Round-trip through JSON so Dates and undefined become what Postgres stores.
  return value === undefined ? Prisma.JsonNull : (JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue);
}
