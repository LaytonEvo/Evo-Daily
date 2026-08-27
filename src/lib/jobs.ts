/**
 * Scheduled work. Every job is idempotent and safe to re-run — Railway cron
 * calling twice, or a retry after a timeout, must not change the outcome.
 */

import type { PrismaClient } from "@prisma/client";
import { generateInstances, sweepMissed } from "./recurrence";
import { getSettings } from "./settings";
import { addDays, todayInLondon, type DateOnly } from "./time";

export async function runGenerateJob(
  db: PrismaClient,
  today: DateOnly = todayInLondon(),
) {
  const organisations = await db.organisation.findMany({ select: { id: true } });
  const results = [];

  for (const org of organisations) {
    const { generationHorizonDays } = await getSettings(db, org.id);
    const result = await generateInstances(db, today, addDays(today, generationHorizonDays), {
      organisationId: org.id,
    });
    results.push({ organisationId: org.id, horizonDays: generationHorizonDays, ...result });
  }

  return { job: "generate" as const, today, results };
}

export async function runSweepJob(db: PrismaClient, today: DateOnly = todayInLondon()) {
  const organisations = await db.organisation.findMany({ select: { id: true } });
  const results = [];

  for (const org of organisations) {
    const { graceDays } = await getSettings(db, org.id);
    const result = await sweepMissed(db, today, graceDays, { organisationId: org.id });
    results.push({ organisationId: org.id, graceDays, ...result });
  }

  return { job: "sweep" as const, today, results };
}
