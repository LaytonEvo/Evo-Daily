import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { sweepMissed } from "./recurrence";
import { todayInLondon, type DateOnly } from "./time";

export const DEFAULT_GRACE_DAYS = 2;
export const DEFAULT_GENERATION_HORIZON_DAYS = 14;

export type OrgSettings = {
  organisationId: string;
  graceDays: number;
  generationHorizonDays: number;
};

type DbClient = PrismaClient | Prisma.TransactionClient;

/** Org settings, creating the single row with defaults if it is missing. */
export async function getSettings(
  db: DbClient,
  organisationId: string,
): Promise<OrgSettings> {
  const existing = await db.settings.findUnique({ where: { organisationId } });
  if (existing) return existing;

  return db.settings.create({
    data: {
      organisationId,
      graceDays: DEFAULT_GRACE_DAYS,
      generationHorizonDays: DEFAULT_GENERATION_HORIZON_DAYS,
    },
  });
}

export const settingsInputSchema = z.object({
  // One day means yesterday's unfinished work is written off tonight; a
  // fortnight means nothing is ever quite closed. Both are legitimate ways to
  // run a shop, so it is a setting rather than a constant — but not an
  // unbounded one, because a grace window longer than a month makes the
  // completion rate meaningless.
  graceDays: z.number().int().min(0).max(30),
});

export type SettingsInput = z.infer<typeof settingsInputSchema>;

/**
 * Change the grace window, and apply it straight away.
 *
 * Shortening it has to sweep: instances that were inside the old window and
 * are outside the new one stay PENDING until the next nightly run otherwise,
 * so the setting would appear not to have worked until tomorrow. The sweep is
 * the same one the cron runs and writes the same audit rows, so nothing about
 * the record depends on which of the two did it.
 */
export async function updateSettings(
  db: PrismaClient,
  organisationId: string,
  input: SettingsInput,
  today: DateOnly = todayInLondon(),
): Promise<OrgSettings & { swept: number }> {
  await getSettings(db, organisationId);

  const settings = await db.settings.update({
    where: { organisationId },
    data: { graceDays: input.graceDays },
  });

  const { missed } = await sweepMissed(db, today, settings.graceDays, { organisationId });
  return { ...settings, swept: missed };
}
