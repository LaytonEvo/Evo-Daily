/**
 * The nudge jobs, by name.
 *
 * Its own module so the two routes that run them — the query-string form and
 * the path form — cannot drift apart on which names exist.
 */

import type { PrismaClient } from "@prisma/client";
import { afternoonNudge, managerDigest, missAlerts, morningBrief } from "./nudges";

export const NUDGE_JOBS = {
  "morning-brief": morningBrief,
  "afternoon-nudge": afternoonNudge,
  "manager-digest": managerDigest,
  "miss-alerts": missAlerts,
} as const;

export type NudgeJob = keyof typeof NUDGE_JOBS;

export function isNudgeJob(name: string | null | undefined): name is NudgeJob {
  return typeof name === "string" && name in NUDGE_JOBS;
}

export function runNudge(
  name: NudgeJob,
  db: PrismaClient,
  options: { onlyUserIds?: string[] } = {},
) {
  return NUDGE_JOBS[name](db, options);
}

export function nudgeNames(): string {
  return Object.keys(NUDGE_JOBS).join(", ");
}
