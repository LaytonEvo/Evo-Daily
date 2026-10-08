import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { errorResponse, requireApiUser } from "@/lib/guards";
import { decideApproval } from "@/lib/approvals";

const schema = z.object({
  decision: z.enum(["approve", "reject"]),
  note: z.string().max(2000).nullish(),
  rework: z.boolean().optional(),
  edits: z.record(z.string(), z.string().max(20000)).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser();
    const { id } = await params;
    const input = schema.parse(await request.json());
    const { approval, alreadyDecided } = await decideApproval(prisma, user, id, input);
    return NextResponse.json({
      status: approval.status,
      executionStatus: approval.executionStatus,
      alreadyDecided,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
