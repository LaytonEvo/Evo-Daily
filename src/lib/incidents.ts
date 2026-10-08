/**
 * Incidents: something wrong that a person has been told about.
 *
 * One alert when it opens. Nothing while it stays open, however many checks
 * see it. A "recovered" message when it closes. That is the whole noise
 * policy, and it is why an outage at 2am produces two messages, not forty.
 */

import { Prisma, Role, type PrismaClient } from "@prisma/client";
import { appUrl, escape, link, managerChannelId, postMessage } from "./slack";

/** DM every active admin who has Slack; the manager channel if none do. */
export async function notifyAdmins(db: PrismaClient, text: string): Promise<number> {
  const admins = await db.user.findMany({
    where: { role: Role.ADMIN, isActive: true, slackUserId: { not: null } },
    select: { slackUserId: true },
  });
  const targets = admins.length ? admins.map((a) => a.slackUserId!) : [managerChannelId()].filter((c): c is string => !!c);
  let sent = 0;
  for (const to of targets) {
    if ((await postMessage(to, text)).ok) sent += 1;
  }
  return sent;
}

export async function openIncident(db: PrismaClient, input: { key: string; title: string; detail?: string }) {
  let incident;
  try {
    incident = await db.incident.create({
      data: { key: input.key, openKey: input.key, title: input.title, detail: input.detail ?? null },
    });
  } catch (error) {
    // Already open: that is the "no repeat alerts" rule doing its job.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { opened: false };
    throw error;
  }
  const sent = await notifyAdmins(
    db,
    `:rotating_light: *${escape(input.title)}*${input.detail ? `\n${escape(input.detail)}` : ""}\n${link(appUrl("/admin/health"), "Open Health")}`,
  );
  await db.incident.update({ where: { id: incident.id }, data: { alertSent: sent > 0 } });
  return { opened: true, incident };
}

export async function resolveIncident(db: PrismaClient, key: string) {
  const open = await db.incident.findUnique({ where: { openKey: key } });
  if (!open) return { resolved: false };
  // Clearing openKey is the claim: a second resolver finds nothing to clear.
  const { count } = await db.incident.updateMany({
    where: { id: open.id, openKey: key },
    data: { openKey: null, resolvedAt: new Date() },
  });
  if (count === 0) return { resolved: false };
  const sent = await notifyAdmins(db, `:white_check_mark: Recovered: ${escape(open.title)}`);
  await db.incident.update({ where: { id: open.id }, data: { recoveredAlertSent: sent > 0 } });
  return { resolved: true };
}

export function openIncidents(db: PrismaClient) {
  return db.incident.findMany({ where: { openKey: { not: null } }, orderBy: { openedAt: "asc" } });
}
