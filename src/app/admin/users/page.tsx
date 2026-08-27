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
      orderBy: { sortOrder: "asc" },
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
        categories={categories.map((c) => ({ id: c.id, name: c.name, colour: c.colour }))}
      />
    </div>
  );
}
