import { prisma } from "@/lib/db";
import { requireAdminPage } from "@/lib/guards";
import { AppShell } from "@/components/app-shell";
import { buildOrgReport, buildWindow } from "@/lib/reports";
import { ReportsScreen } from "./reports-screen";

export const metadata = { title: "Reports · EvoTasks" };
export const dynamic = "force-dynamic";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; from?: string; to?: string }>;
}) {
  const admin = await requireAdminPage();
  const params = await searchParams;

  const window = buildWindow({
    days: params.days ? Number(params.days) : undefined,
    from: params.from,
    to: params.to,
  });

  const report = await buildOrgReport(prisma, admin.organisationId, window);

  return (
    <AppShell user={admin} active="reports" title="Reports">
      <ReportsScreen report={report} />
    </AppShell>
  );
}
