import { InstanceStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAdminPage } from "@/lib/guards";
import { AppShell } from "@/components/app-shell";
import { describeSchedule } from "@/lib/recurrence";
import { templateCompletionRates } from "@/lib/reports";
import { toDateOnly } from "@/lib/time";
import { TemplatesScreen, type TemplateRow } from "./templates-screen";

export const metadata = { title: "Tasks · EvoTasks" };
export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const admin = await requireAdminPage();

  const [templates, users, categories, rates, recorded] = await Promise.all([
    prisma.taskTemplate.findMany({
      where: { organisationId: admin.organisationId },
      include: { assignee: { select: { id: true, name: true } } },
      orderBy: [{ isActive: "desc" }, { title: "asc" }],
    }),
    prisma.user.findMany({
      where: { organisationId: admin.organisationId },
      select: { id: true, name: true, isActive: true },
      orderBy: { name: "asc" },
    }),
    prisma.category.findMany({
      where: { organisationId: admin.organisationId },
      orderBy: { sortOrder: "asc" },
    }),
    templateCompletionRates(prisma, admin.organisationId, 30),
    // All time, not the 30-day window: a task completed once last year is
    // still a record, and deleting it would still rewrite that month.
    prisma.taskInstance.groupBy({
      by: ["templateId"],
      where: {
        template: { organisationId: admin.organisationId },
        status: { not: InstanceStatus.PENDING },
      },
      _count: { _all: true },
    }),
  ]);

  const recordedDays = new Map(recorded.map((r) => [r.templateId, r._count._all]));

  const rows: TemplateRow[] = templates.map((template) => {
    const totals = rates.get(template.id);
    return {
      id: template.id,
      title: template.title,
      description: template.description,
      assigneeId: template.assigneeId,
      assigneeName: template.assignee.name,
      categoryId: template.categoryId,
      frequency: template.frequency,
      daysOfWeek: template.daysOfWeek,
      dayOfWeek: template.dayOfWeek,
      dayOfMonth: template.dayOfMonth,
      dueTime: template.dueTime,
      startDate: toDateOnly(template.startDate),
      endDate: template.endDate ? toDateOnly(template.endDate) : null,
      isActive: template.isActive,
      scheduleLabel: describeSchedule(template),
      completionRate: totals?.completionRate ?? null,
      assignedLast30: totals?.assigned ?? 0,
      recordedDays: recordedDays.get(template.id) ?? 0,
    };
  });

  return (
    <AppShell user={admin} active="templates" title="Tasks">
      <TemplatesScreen
        templates={rows}
        users={users}
        categories={categories.map((c) => ({
          id: c.id,
          name: c.name,
          colour: c.colour,
          isActive: c.isActive,
        }))}
      />
    </AppShell>
  );
}
