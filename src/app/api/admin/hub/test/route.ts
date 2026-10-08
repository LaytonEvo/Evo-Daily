import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { errorResponse, requireApiAdmin } from "@/lib/guards";
import { requestApproval } from "@/lib/approvals";
import { createTask } from "@/lib/create-task";
import { formatTimeLondon, todayInLondon } from "@/lib/time";

const schema = z.object({ kind: z.enum(["approval", "task"]) });

/**
 * The Phase 2 gate, end to end: a test approval to approve, edit or reject,
 * and a test module-raised task to tick off. Neither touches anything outside.
 */
export async function POST(request: Request) {
  try {
    const admin = await requireApiAdmin();
    const { kind } = schema.parse(await request.json());
    const stamp = formatTimeLondon(new Date());

    if (kind === "approval") {
      const { approval } = await requestApproval(prisma, {
        organisationId: admin.organisationId,
        module: "hub",
        itemType: "test",
        title: `Test approval (${stamp})`,
        summary: "A harmless test. Approving it writes one line to the activity log and nothing else.",
        payload: { message: "Hello from the approvals inbox" },
        assigneeId: admin.id,
        requestedById: admin.id,
      });
      return NextResponse.json({ ok: true, href: `/approvals/${approval.id}` });
    }

    await createTask(prisma, {
      title: `Test task from the hub (${stamp})`,
      description: "Raised by the Health page to prove module-raised tasks work. Tick it off.",
      assigneeId: admin.id,
      due: todayInLondon(),
      sourceModule: "hub",
      sourceRef: `/admin/health#test-${Date.now()}`,
    });
    return NextResponse.json({ ok: true, href: "/my-day" });
  } catch (error) {
    return errorResponse(error);
  }
}
