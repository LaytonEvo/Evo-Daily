import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { errorResponse, requireApiUser } from "@/lib/guards";
import { retryExecution } from "@/lib/approvals";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser();
    const { id } = await params;
    const approval = await retryExecution(prisma, user, id);
    return NextResponse.json({ status: approval.status, executionStatus: approval.executionStatus });
  } catch (error) {
    return errorResponse(error);
  }
}
