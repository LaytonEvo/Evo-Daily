import { prisma } from "@/lib/db";
import { requireAdminPage } from "@/lib/guards";
import { AppShell } from "@/components/app-shell";
import { listAbsences } from "@/lib/absences";
import { lastSeenByUser, recentSignIns } from "@/lib/sign-ins";
import { toDateOnly, todayInLondon } from "@/lib/time";
import { UsersScreen } from "./users-screen";
import { SignInLog } from "./sign-in-log";
import { SettingsEditor } from "./settings-editor";
import { getSettings } from "@/lib/settings";
import { leadDaysFor } from "@/lib/lead-time";

export const metadata = { title: "People · EvoTasks" };
export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const admin = await requireAdminPage();
  const today = todayInLondon();

  const [users, categories, absences, signIns, lastSeen, settings, noticeSources] =
    await Promise.all([
    prisma.user.findMany({
      where: { organisationId: admin.organisationId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        slackUserId: true,
        managerId: true,
        mustChangePassword: true,
        _count: { select: { assignedTemplates: { where: { isActive: true } } } },
      },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    }),
    prisma.category.findMany({
      where: { organisationId: admin.organisationId },
      orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }],
      // Usage decides whether a category can be removed outright or only
      // retired, so the screen can say which before the admin clicks.
      include: { _count: { select: { templates: true, instances: true } } },
    }),
    listAbsences(prisma, admin.organisationId),
    recentSignIns(prisma, admin.organisationId),
    lastSeenByUser(prisma, admin.organisationId),
    getSettings(prisma, admin.organisationId),
    prisma.taskTemplate.findMany({
      where: { organisationId: admin.organisationId, isActive: true },
      select: { frequency: true, leadDays: true },
    }),
  ]);

  // The most notice any task asks for. If it reaches past the horizon the
  // setting silently does less than it says, so the card can point that out
  // rather than leaving somebody to wonder why the stocktake never appears
  // early.
  const longestNotice = noticeSources.reduce((most, t) => Math.max(most, leadDaysFor(t)), 0);

  return (
    <AppShell user={admin} active="users" title="People">
      <UsersScreen
        currentUserId={admin.id}
        users={users.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          isActive: u.isActive,
          slackUserId: u.slackUserId,
          managerId: u.managerId,
          mustChangePassword: u.mustChangePassword,
          activeTasks: u._count.assignedTemplates,
          lastSeen: lastSeen.get(u.id)?.toISOString() ?? null,
        }))}
        categories={categories.map((c) => ({
          id: c.id,
          name: c.name,
          colour: c.colour,
          isActive: c.isActive,
          templateCount: c._count.templates,
          instanceCount: c._count.instances,
        }))}
        absences={absences.map((a) => ({
          id: a.id,
          from: toDateOnly(a.from),
          to: toDateOnly(a.to),
          reason: a.reason,
          user: a.user,
          cover: a.cover,
          covers: a.covers.map((c) => ({
            templateId: c.templateId,
            coverUserId: c.coverUserId,
            coverName: c.cover?.name ?? null,
          })),
        }))}
        // A server component handed through as a slot: the screen around it is
        // a client component, and lib/sign-ins reaches for Prisma.
        today={today}
        settings={
          <SettingsEditor
            graceDays={settings.graceDays}
            generationHorizonDays={settings.generationHorizonDays}
            longestNotice={longestNotice}
          />
        }
        signInLog={<SignInLog rows={signIns} today={today} />}
      />
    </AppShell>
  );
}
