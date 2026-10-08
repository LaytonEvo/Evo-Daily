import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/guards";
import { ensureInstancesForToday, getMyDay } from "@/lib/my-day";
import { AppShell } from "@/components/app-shell";
import { storageEnabled } from "@/lib/storage";
import { MyDayScreen } from "./my-day-screen";
import { DayCheck } from "./day-check";
import { pendingDayCheck } from "@/lib/day-check";

export const metadata = { title: "My day · EvoTasks" };
export const dynamic = "force-dynamic";

export default async function MyDayPage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>;
}) {
  const user = await requireUser();
  if (user.mustChangePassword) redirect("/change-password");

  const { denied } = await searchParams;

  // Belt and braces: if the cron failed or Railway slept the service, nobody
  // loses a day's tasks. Generation is idempotent, so this is safe on every load.
  await ensureInstancesForToday(prisma, user.organisationId);
  const day = await getMyDay(prisma, user);

  // Only here, on the screen everybody lands on. A dialog that follows you
  // onto Messages is a punishment, and the question is not one.
  const owed = await pendingDayCheck(prisma, user);

  return (
    <AppShell user={user}>
      <MyDayScreen
        user={{ name: user.name }}
        day={day}
        notice={denied === "admin" ? "That area is for admins only." : null}
        attachmentsEnabled={storageEnabled()}
      />
      {owed ? (
        <DayCheck
          day={owed.dayLabel}
          completed={owed.completed}
          total={owed.total}
          missed={owed.missed}
        />
      ) : null}
    </AppShell>
  );
}
