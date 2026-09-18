import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BarChart3, Eye } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireAdminPage } from "@/lib/guards";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { getDayFor } from "@/lib/my-day";
import { generateInstances } from "@/lib/recurrence";
import { storageEnabled } from "@/lib/storage";
import { addDays, formatDateOnlyLong, isDateOnly, todayInLondon } from "@/lib/time";
import { cn } from "@/lib/utils";
import { MyDayScreen } from "@/app/my-day/my-day-screen";

export const dynamic = "force-dynamic";

/**
 * Somebody else's day, as they see it — today, or a day still to come.
 *
 * Read-only, deliberately. An admin can already complete anyone's task through
 * the API and can mark one not-done from the reports screen, so this withholds
 * no power they have — it just refuses to hand it to them by mis-tap while
 * they are reading.
 *
 * Tomorrow lives here and nowhere else on purpose. A member's own screen is
 * what they owe now; putting the next day on it turns a finishable list into a
 * backlog you are already behind on, which is the one thing /my-day is built
 * not to be. An admin asking "what is Brad walking into tomorrow?" is a
 * different question, and it belongs on the admin's screen.
 */
export default async function ViewDayPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ on?: string }>;
}) {
  const admin = await requireAdminPage();
  const { userId } = await params;
  const query = await searchParams;

  const today = todayInLondon();
  const asked = query.on && isDateOnly(query.on) ? query.on : today;

  // Same reason /my-day does it: a failed cron must not make somebody's day
  // look empty. Generating through the day being viewed covers tomorrow too,
  // and generation is idempotent, so this is safe on every load.
  await generateInstances(prisma, today, asked, { organisationId: admin.organisationId });

  const viewed = await getDayFor(prisma, admin, userId, { on: asked, today });
  if (!viewed) notFound();

  const { person, day, isToday, on: showing } = viewed;
  const tomorrow = addDays(today, 1);

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

        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5">
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

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <DayTab href={`/admin/users/${person.id}/day`} active={isToday} label="Today" />
          <DayTab
            href={`/admin/users/${person.id}/day?on=${tomorrow}`}
            active={!isToday}
            label="Tomorrow"
          />
          {!isToday ? (
            // The date being shown, not tomorrow's: the page takes any future
            // date in ?on=, and a note naming a different day to the list under
            // it is worse than no note.
            <p className="text-xs text-muted-foreground">
              {formatDateOnlyLong(showing)} — what is scheduled, not a backlog. {person.name} does not
              see this.
            </p>
          ) : null}
        </div>

        <MyDayScreen
          user={{ name: person.name }}
          day={day}
          notice={null}
          attachmentsEnabled={storageEnabled()}
          readOnly
          upcoming={!isToday}
        />
      </main>
    </AppShell>
  );
}

function DayTab({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input bg-card hover:bg-accent",
      )}
    >
      {label}
    </Link>
  );
}
