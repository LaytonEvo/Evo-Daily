/**
 * Hub-wide settings, starting with the automation kill switches.
 *
 * A module's switch off means its jobs stop taking external actions — no
 * publishing, no Xero writes, no Slack nudges — while its screens, its data
 * and the approvals queue keep working. One global switch pauses them all.
 * Every change is kept with who made it and why.
 */

import { Prisma, Role, type PrismaClient } from "@prisma/client";

export const AUTOMATION_MODULES = ["tasks", "email", "tiktok", "finance", "reporting", "hub"] as const;
export type AutomationModule = (typeof AUTOMATION_MODULES)[number];

const GLOBAL = "automation.global";
const key = (module: string) => `automation.${module}`;

async function getBoolean(db: PrismaClient, k: string, fallback: boolean): Promise<boolean> {
  const row = await db.hubSetting.findUnique({ where: { key: k } });
  return typeof row?.value === "boolean" ? row.value : fallback;
}

export async function setSetting(
  db: PrismaClient,
  k: string,
  value: Prisma.InputJsonValue,
  by: { userId: string | null; reason?: string | null },
) {
  await db.$transaction([
    db.hubSetting.upsert({
      where: { key: k },
      create: { key: k, value, updatedById: by.userId },
      update: { value, updatedById: by.userId },
    }),
    db.hubSettingChange.create({ data: { key: k, value, reason: by.reason ?? null, userId: by.userId } }),
  ]);
}

/** Whether a module may take external actions right now. */
export async function automationEnabled(db: PrismaClient, module: string): Promise<boolean> {
  if (!(await getBoolean(db, GLOBAL, true))) return false;
  return getBoolean(db, key(module), true);
}

export async function automationState(db: PrismaClient) {
  const rows = await db.hubSetting.findMany({ where: { key: { startsWith: "automation." } } });
  const on = (k: string) => {
    const row = rows.find((r) => r.key === k);
    return typeof row?.value === "boolean" ? row.value : true;
  };
  return {
    global: on(GLOBAL),
    modules: Object.fromEntries(AUTOMATION_MODULES.map((m) => [m, on(key(m))])) as Record<AutomationModule, boolean>,
  };
}

export function setAutomation(
  db: PrismaClient,
  module: AutomationModule | "global",
  enabled: boolean,
  by: { userId: string; reason?: string | null },
) {
  return setSetting(db, module === "global" ? GLOBAL : key(module), enabled, by);
}

/**
 * The person who looks after day-to-day hub health and gets the tasks for it.
 * Set on the Health page; until it is, the longest-standing active admin.
 */
export async function hubOwnerId(db: PrismaClient): Promise<string | null> {
  const row = await db.hubSetting.findUnique({ where: { key: "hub.ownerId" } });
  if (typeof row?.value === "string") {
    const owner = await db.user.findFirst({ where: { id: row.value, isActive: true }, select: { id: true } });
    if (owner) return owner.id;
  }
  const admin = await db.user.findFirst({
    where: { role: Role.ADMIN, isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return admin?.id ?? null;
}
