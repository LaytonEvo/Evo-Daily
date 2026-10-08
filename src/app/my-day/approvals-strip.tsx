import Link from "next/link";
import { Inbox } from "lucide-react";
import { prisma } from "@/lib/db";
import { pendingCounts } from "@/lib/approvals";
import type { SessionUser } from "@/lib/guards";

/** Approvals waiting on this person, with those over 48 hours called out. */
export async function ApprovalsStrip({ user }: { user: SessionUser }) {
  const { total, stale } = await pendingCounts(prisma, user);
  if (total === 0) return null;
  return (
    <Link
      href="/approvals"
      className={`mt-4 flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium ${
        stale ? "bg-warning/10 text-warning" : "bg-accent text-accent-foreground"
      }`}
    >
      <Inbox className="h-4 w-4 shrink-0" />
      {total} approval{total === 1 ? "" : "s"} waiting for you
      {stale ? `, ${stale} for over 48 hours` : ""}. Review →
    </Link>
  );
}
