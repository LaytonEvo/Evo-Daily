/**
 * "Copy for Claude Code": one block with everything needed to start fixing a
 * failure, so nobody has to gather it by hand. Pasted into Claude Code with
 * the repo open, it points at the spec and the registry entry.
 */

import type { AppError, JobRun } from "@prisma/client";
import { getJob } from "./job-registry";

export function copyForRun(run: JobRun, recent: Pick<JobRun, "status" | "startedAt">[]): string {
  const job = getJob(run.jobName);
  return [
    `A background job in the Evo Ops Hub (repo LaytonEvo/Evo-Daily) needs fixing.`,
    ``,
    `Job: ${run.jobName} (module ${run.module}, trigger ${run.trigger})`,
    job ? `Schedule: ${job.schedule}. Good run: ${job.goodRun}. Warning if: ${job.warningIf}.` : ``,
    `Run ${run.id} started ${run.startedAt.toISOString()}, status ${run.status}.`,
    `Message: ${run.message ?? "—"}`,
    ``,
    `Details:`,
    "```json",
    JSON.stringify(run.details, null, 2),
    "```",
    ``,
    `Recent runs: ${recent.map((r) => `${r.startedAt.toISOString().slice(0, 16)} ${r.status}`).join(", ")}`,
    ``,
    `The job is registered in src/lib/job-registry.ts. The spec is docs/hub/evo-ops-hub-spec.md,`,
    `section "Monitoring and health". Find the root cause, fix it with a test, and open a PR`,
    `to staging first. Jobs must stay idempotent.`,
  ]
    .filter((l) => l !== undefined)
    .join("\n");
}

export function copyForError(error: AppError): string {
  return [
    `The Evo Ops Hub (repo LaytonEvo/Evo-Daily) hit a server error.`,
    ``,
    `When: ${error.at.toISOString()}`,
    `Where: ${error.method ?? ""} ${error.path ?? "unknown"} (${error.kind ?? "unknown"})`,
    `Message: ${error.message}`,
    error.digest ? `Digest: ${error.digest}` : ``,
    ``,
    "```",
    error.stack ?? "(no stack)",
    "```",
    ``,
    `Find the root cause, fix it with a test, and open a PR to staging first.`,
  ].join("\n");
}
