import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BarChart3, Eye } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireAdminPage } from "@/lib/guards";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { threadsForMember } from "@/lib/messages";
import { storageEnabled } from "@/lib/storage";
import { MessagesScreen } from "@/app/messages/messages-screen";
import { ViewAsTabs } from "../day/view-as-tabs";

export const dynamic = "force-dynamic";

/**
 * One person's conversations, as they see them.
 *
 * Read-only like the rest of viewing as somebody: the unread marks are theirs,
 * so the screen answers "I replied last night, has he seen it?" — which is not
 * a question any other screen can answer. A composer here would post as the
 * admin on a page headed "Viewing as Brad", which is exactly the ambiguity
 * worth not introducing.
 */
export default async function MemberMessagesPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const admin = await requireAdminPage();
  const { userId } = await params;

  const viewed = await threadsForMember(prisma, admin, userId);
  if (!viewed) notFound();

  const { person, threads } = viewed;
  const firstName = person.name.split(" ")[0] || person.name;

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

        <div className="mb-4">
          <ViewAsTabs userId={person.id} current="messages" />
        </div>

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
          readOnly
          unreadBy={firstName}
        />
      </main>
    </AppShell>
  );
}
