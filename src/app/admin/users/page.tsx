import { prisma } from "@/lib/db";
import { requireAdminPage } from "@/lib/guards";
import { AppShell } from "@/components/app-shell";
import { listAbsences } from "@/lib/absences";
import { recentSignIns } from "@/lib/sign-ins";
import { recentActivity } from "@/lib/activity";
import { toDateOnly, todayInLondon } from "@/lib/time";
import { UsersScreen } from "./users-screen";
import { SignInLog } from "./sign-in-log";
import { ActivityLog } from "./activity-log";
import { SettingsEditor } from "./settings-editor";
import { getSettings } from "@/lib/settings";
import { leadDaysFor } from "@/lib/lead-time";

export const metadata = { title: "People · EvoTasks" };
export const dynamic = "force-dynamic";

/** Two weeks is long enough to see a habit and short enough to fit a row. */
const ACTIVITY_DAYS = 14;

export default async function UsersPage() {
  const admin = await requireAdminPage();
  const today = todayInLondon();

  const [users, categories, absences, signIns, activity, settings, noticeSources] =
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
    recentActivity(prisma, admin.organisationId, ACTIVITY_DAYS, today),
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
          // The real thing now: when they last opened a page, not when they
          // last typed a password.
          lastSeen: activity.get(u.id)?.lastActiveAt?.toISOString() ?? null,
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
        activityLog={
          <ActivityLog
            today={today}
            days={ACTIVITY_DAYS}
            rows={users.map((u) => ({
              id: u.id,
              name: u.name,
              isActive: u.isActive,
              lastActiveAt: activity.get(u.id)?.lastActiveAt?.toISOString() ?? null,
              days: activity.get(u.id)?.days ?? [],
            }))}
          />
        }
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
