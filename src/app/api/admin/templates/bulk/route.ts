import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { errorResponse, requireApiAdmin } from "@/lib/guards";
import { reassignTemplates } from "@/lib/templates";

const schema = z.object({
  action: z.literal("reassign"),
  templateIds: z.array(z.string()).min(1),
  assigneeId: z.string().min(1),
});

/** Bulk reassignment. Affects future instances only. */
export async function POST(request: Request) {
  try {
    const admin = await requireApiAdmin();
    const body = schema.parse(await request.json());
    const count = await reassignTemplates(
      prisma,
      admin.organisationId,
      body.templateIds,
      body.assigneeId,
    );
    return NextResponse.json({ reassigned: count });
  } catch (error) {
    return errorResponse(error);
  }
}
