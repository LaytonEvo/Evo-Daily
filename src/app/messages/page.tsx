import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/guards";
import { AppShell } from "@/components/app-shell";
import { threadsFor } from "@/lib/messages";
import { storageEnabled } from "@/lib/storage";
import { MessagesScreen } from "./messages-screen";

export const metadata = { title: "Messages · EvoTasks" };
export const dynamic = "force-dynamic";

export default async function MessagesPage() {
  const user = await requireUser();
  const threads = await threadsFor(prisma, user);

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
      />
    </AppShell>
  );
}
