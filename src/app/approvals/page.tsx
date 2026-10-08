import Link from "next/link";
import { ApprovalStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireModulePage } from "@/lib/guards";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { decidableWhere, pendingFor } from "@/lib/approvals";
import { moduleLabel } from "@/lib/hub";
import { formatDateOnly, formatTimeLondon, todayInLondon } from "@/lib/time";
import { ApprovalCard } from "./approval-card";
import { toCard } from "./serialize";

export const metadata = { title: "Approvals · EvoTasks" };
export const dynamic = "force-dynamic";

const STATUS_BADGE = {
  APPROVED: "success",
  REJECTED: "destructive",
  EXPIRED: "muted",
  PENDING: "default",
} as const;

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ module?: string; mine?: string }>;
}) {
  const user = await requireModulePage("approvals");
  const params = await searchParams;
  const mineOnly = params.mine === "1";

  const [pending, allPending, recent] = await Promise.all([
    pendingFor(prisma, user, { module: params.module, mineOnly }),
    pendingFor(prisma, user),
    prisma.approval.findMany({
      where: {
        status: { not: ApprovalStatus.PENDING },
        decidedAt: { gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) },
        OR: [decidableWhere(user), { requestedById: user.id }],
      },
      include: { decidedBy: { select: { name: true } } },
      orderBy: { updatedAt: "desc" },
      take: 30,
    }),
  ]);

  const modules = [...new Set(allPending.map((a) => a.module))];
  const link = (next: { module?: string | null; mine?: boolean }) => {
    const q = new URLSearchParams();
    const m = next.module === undefined ? params.module : next.module;
    const mine = next.mine === undefined ? mineOnly : next.mine;
    if (m) q.set("module", m);
    if (mine) q.set("mine", "1");
    const s = q.toString();
    return `/approvals${s ? `?${s}` : ""}`;
  };
  const chip = (active: boolean) =>
    active ? "rounded-full bg-primary px-3 py-1 text-primary-foreground" : "rounded-full bg-accent px-3 py-1 text-accent-foreground";

  return (
    <AppShell user={user} active="approvals" title="Approvals">
      <div className="flex flex-col gap-5 py-6">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link href={link({ module: null })} className={chip(!params.module)}>
            All ({allPending.length})
          </Link>
          {modules.map((m) => (
            <Link key={m} href={link({ module: m })} className={chip(params.module === m)}>
              {m === "hub" ? "Hub" : moduleLabel(m)}
            </Link>
          ))}
          <Link href={link({ mine: !mineOnly })} className={`ml-auto ${chip(mineOnly)}`}>
            Assigned to me
          </Link>
        </div>

        {pending.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground">Nothing waiting for you.</Card>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {pending.map((a) => (
              <ApprovalCard key={a.id} approval={toCard(a)} />
            ))}
          </div>
        )}

        {recent.length > 0 ? (
          <Card className="overflow-hidden">
            <div className="border-b px-5 py-3 text-sm font-bold">Decided in the last 14 days</div>
            <ul className="divide-y text-sm">
              {recent.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5">
                  <Badge variant={STATUS_BADGE[a.status]}>{a.status.toLowerCase()}</Badge>
                  <Link href={`/approvals/${a.id}`} className="font-medium hover:underline">
                    {a.title}
                  </Link>
                  {a.executionStatus === "failed" ? <Badge variant="destructive">action failed</Badge> : null}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {a.decidedBy?.name ?? "—"}
                    {a.decidedAt
                      ? ` · ${todayInLondon(a.decidedAt) === todayInLondon() ? "today" : formatDateOnly(todayInLondon(a.decidedAt))} ${formatTimeLondon(a.decidedAt)}`
                      : ""}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </AppShell>
  );
}
