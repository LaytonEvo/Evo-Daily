import { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/guards";
import { AppShell } from "@/components/app-shell";
import { threadsFor, type ThreadScope } from "@/lib/messages";
import { storageEnabled } from "@/lib/storage";
import { MessagesScreen } from "./messages-screen";

export const metadata = { title: "Messages · EvoTasks" };
export const dynamic = "force-dynamic";

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const user = await requireUser();
  const { scope } = await searchParams;

  const canSeeEveryone = user.role === Role.ADMIN;
  const chosen: ThreadScope = canSeeEveryone && scope === "all" ? "all" : "mine";
  const threads = await threadsFor(prisma, user, chosen);

  return (
    <AppShell user={user} active="messages" title="Messages">
      <MessagesScreen
        threads={threads.map((thread) => ({
          ...thread,
          comments: thread.comments.map((c) => ({
            ...c,
            createdAt: c.createdAt.toISOString(),
          })),
          lastAt: thread.lastAt.toISOString(),
        }))}
        attachmentsEnabled={storageEnabled()}
        scope={canSeeEveryone ? chosen : undefined}
      />
    </AppShell>
  );
}
