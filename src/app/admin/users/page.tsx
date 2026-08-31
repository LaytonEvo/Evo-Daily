import { prisma } from "@/lib/db";
import { requireAdminPage } from "@/lib/guards";
import { AppHeader } from "@/components/app-header";
import { UsersScreen } from "./users-screen";

export const metadata = { title: "People · EvoTasks" };
export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const admin = await requireAdminPage();

  const [users, categories] = await Promise.all([
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
  ]);

  return (
    <div className="min-h-dvh">
      <AppHeader user={admin} active="users" />
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
        }))}
        categories={categories.map((c) => ({
          id: c.id,
          name: c.name,
          colour: c.colour,
          isActive: c.isActive,
          templateCount: c._count.templates,
          instanceCount: c._count.instances,
        }))}
      />
    </div>
  );
}
