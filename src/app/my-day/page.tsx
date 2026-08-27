import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/guards";
import { ensureInstancesForToday, getMyDay } from "@/lib/my-day";
import { AppHeader } from "@/components/app-header";
import { MyDayScreen } from "./my-day-screen";

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

  return (
    <div className="min-h-dvh">
      <AppHeader user={user} />
      <MyDayScreen
        user={{ name: user.name }}
        day={day}
        notice={denied === "admin" ? "That area is for admins only." : null}
      />
    </div>
  );
}
