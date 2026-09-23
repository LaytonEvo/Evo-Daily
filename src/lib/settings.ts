import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { generateInstances, sweepMissed } from "./recurrence";
import { addDays, todayInLondon, type DateOnly } from "./time";

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
  graceDays: z.number().int().min(0).max(30).optional(),
  // How far ahead task occurrences are created. It is also how far ahead
  // anybody can be shown their work, so a monthly stocktake cannot give five
  // days' notice unless the horizon reaches past it.
  generationHorizonDays: z.number().int().min(7).max(180).optional(),
}).refine(
  (value) => Object.keys(value).length > 0,
  "Nothing to change",
);

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
): Promise<OrgSettings & { swept: number; generated: number }> {
  const before = await getSettings(db, organisationId);

  const settings = await db.settings.update({
    where: { organisationId },
    data: {
      ...(input.graceDays !== undefined ? { graceDays: input.graceDays } : {}),
      ...(input.generationHorizonDays !== undefined
        ? { generationHorizonDays: input.generationHorizonDays }
        : {}),
    },
  });

  const { missed } = await sweepMissed(db, today, settings.graceDays, { organisationId });

  // Extending the horizon fills the new days now rather than at 00:05
  // tomorrow. Shortening it leaves what already exists: those rows are
  // unstarted work nobody has seen, and deleting them to satisfy a number
  // would be churn — the screens read no further than the setting anyway, and
  // the next edit to a task prunes its tail as a matter of course.
  const generated =
    settings.generationHorizonDays > before.generationHorizonDays
      ? (
          await generateInstances(
            db,
            addDays(today, before.generationHorizonDays),
            addDays(today, settings.generationHorizonDays),
            { organisationId },
          )
        ).created
      : 0;

  return { ...settings, swept: missed, generated };
}
