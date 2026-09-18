import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BarChart3, Eye } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireAdminPage } from "@/lib/guards";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { ensureInstancesForToday, getDayFor } from "@/lib/my-day";
import { storageEnabled } from "@/lib/storage";
import { MyDayScreen } from "@/app/my-day/my-day-screen";

export const dynamic = "force-dynamic";

/**
 * Somebody else's day, as they see it.
 *
 * Read-only, deliberately. An admin can already complete anyone's task through
 * the API and can mark one not-done from the reports screen, so this withholds
 * no power they have — it just refuses to hand it to them by mis-tap while
 * they are reading. Everything on this screen is already visible to an admin
 * in Reports; the only thing new is the shape.
 */
export default async function ViewDayPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const admin = await requireAdminPage();
  const { userId } = await params;

  // Same reason /my-day does it: a failed cron must not make somebody's day
  // look empty. Idempotent, and scoped to the admin's own organisation.
  await ensureInstancesForToday(prisma, admin.organisationId);

  const viewed = await getDayFor(prisma, admin, userId);
  if (!viewed) notFound();

  const { person, day } = viewed;

  return (
    <AppShell user={admin} active="users" title="People">
      <main className="mx-auto w-full max-w-2xl pb-16 pt-2">
        <Link
          href="/admin/users"
          className="-ml-2 mb-2 inline-flex h-10 items-center gap-1.5 px-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          People
        </Link>

        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5">
          <p className="inline-flex items-center gap-2 text-sm font-medium">
            <Eye className="h-4 w-4 shrink-0 text-primary" />
            Viewing as {person.name}
          </p>
          <Badge variant="muted">Read only</Badge>
          {!person.isActive ? <Badge variant="muted">Deactivated</Badge> : null}
          <Link
            href={`/admin/reports/${person.id}`}
            className="ml-auto inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            <BarChart3 className="h-4 w-4" />
            Their report
          </Link>
        </div>

        <MyDayScreen
          user={{ name: person.name }}
          day={day}
          notice={null}
          attachmentsEnabled={storageEnabled()}
          readOnly
        />
      </main>
    </AppShell>
  );
}
