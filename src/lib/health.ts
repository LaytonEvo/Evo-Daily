/**
 * Green, amber or red, per job and per module, for the Health page.
 *
 *   red    a failed last run, or an open incident (missed window, failing)
 *   amber  a warning, never run yet, or the module's automation switched off
 *   green  everything else
 */

import { JobRunStatus, type Incident, type JobRun } from "@prisma/client";

export type Light = "green" | "amber" | "red";

const RANK: Record<Light, number> = { green: 0, amber: 1, red: 2 };

export function worst(lights: Light[]): Light {
  return lights.reduce<Light>((w, l) => (RANK[l] > RANK[w] ? l : w), "green");
}

export function jobLight(last: Pick<JobRun, "status"> | null, incidents: Pick<Incident, "key">[], jobName: string): Light {
  if (incidents.some((i) => i.key === `job-missed:${jobName}` || i.key === `job-failing:${jobName}`)) return "red";
  if (!last) return "amber";
  if (last.status === JobRunStatus.FAILED) return "red";
  if (last.status === JobRunStatus.WARNING) return "amber";
  return "green";
}

export function moduleLight(jobLights: Light[], automationOn: boolean): Light {
  const light = worst(jobLights);
  return !automationOn && light === "green" ? "amber" : light;
}
