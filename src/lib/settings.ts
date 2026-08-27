import type { Prisma, PrismaClient } from "@prisma/client";

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
