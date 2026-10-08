import Link from "next/link";
import { notFound } from "next/navigation";
import { ApprovalStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireModulePage } from "@/lib/guards";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { canDecide, canView } from "@/lib/approvals";
import { formatDateOnly, formatTimeLondon, todayInLondon } from "@/lib/time";
import { ApprovalCard } from "../approval-card";
import { toCard } from "../serialize";
import { RetryButton } from "./retry-button";

export const metadata = { title: "Approval · EvoTasks" };
export const dynamic = "force-dynamic";

function when(at: Date) {
  return `${formatDateOnly(todayInLondon(at), { weekday: true })} ${formatTimeLondon(at)}`;
}

export default async function ApprovalPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireModulePage("approvals");
  const { id } = await params;
  const approval = await prisma.approval.findUnique({
    where: { id },
    include: { assignee: { select: { name: true } }, decidedBy: { select: { name: true } } },
  });
  if (!approval || !canView(user, approval)) notFound();

  const decidable = canDecide(user, approval);

  return (
    <AppShell user={user} active="approvals" title="Approval">
      <div className="flex max-w-2xl flex-col gap-4 py-6">
        <Link href="/approvals" className="text-sm text-muted-foreground hover:text-foreground">
          ← Approvals
        </Link>
        {approval.status === ApprovalStatus.PENDING && decidable ? (
          <ApprovalCard approval={toCard(approval)} />
        ) : (
          <Card className="flex flex-col gap-3 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{approval.status.toLowerCase()}</Badge>
              {approval.executionStatus ? (
                <Badge variant={approval.executionStatus === "success" ? "success" : approval.executionStatus === "failed" ? "destructive" : "muted"}>
                  action {approval.executionStatus}
                </Badge>
              ) : null}
            </div>
            <h2 className="text-lg font-bold">{approval.title}</h2>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{approval.summary}</p>
          </Card>
        )}

        <Card className="p-5 text-sm">
          <dl className="grid grid-cols-2 gap-3">
            <div>
              <dt className="text-xs text-muted-foreground">Raised</dt>
              <dd>{when(approval.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">For</dt>
              <dd>{approval.assignee?.name ?? "Any approver for this module"}</dd>
            </div>
            {approval.decidedAt ? (
              <div>
                <dt className="text-xs text-muted-foreground">Decided</dt>
                <dd>
                  {when(approval.decidedAt)} by {approval.decidedBy?.name ?? "—"}
                </dd>
              </div>
            ) : null}
            {approval.expiresAt ? (
              <div>
                <dt className="text-xs text-muted-foreground">Expires</dt>
                <dd>{when(approval.expiresAt)}</dd>
              </div>
            ) : null}
            {approval.decisionNote ? (
              <div className="col-span-2">
                <dt className="text-xs text-muted-foreground">Note</dt>
                <dd className="whitespace-pre-wrap">{approval.decisionNote}</dd>
              </div>
            ) : null}
            {approval.edits ? (
              <div className="col-span-2">
                <dt className="text-xs text-muted-foreground">Edited before approving</dt>
                <dd>
                  <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">{JSON.stringify(approval.edits, null, 2)}</pre>
                </dd>
              </div>
            ) : null}
            {approval.executionResult ? (
              <div className="col-span-2">
                <dt className="text-xs text-muted-foreground">Result</dt>
                <dd>
                  <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">
                    {JSON.stringify(approval.executionResult, null, 2)}
                  </pre>
                </dd>
              </div>
            ) : null}
          </dl>
          {approval.executionStatus === "failed" && decidable ? (
            <div className="mt-4">
              <RetryButton id={approval.id} />
            </div>
          ) : null}
        </Card>
      </div>
    </AppShell>
  );
}
