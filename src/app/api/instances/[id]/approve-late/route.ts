import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { errorResponse, requireApiAdmin, toActor } from "@/lib/guards";
import { approveLate } from "@/lib/instances";

const schema = z.object({ approved: z.boolean().default(true) });

/** Accept a late completion, or take that acceptance back. Admins only. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiAdmin();
    const { id } = await params;
    const { approved } = schema.parse(await request.json().catch(() => ({})));

    const instance = await approveLate(prisma, id, toActor(user), { approved });

    return NextResponse.json({
      id: instance.id,
      lateApprovedAt: instance.lateApprovedAt,
      lateApprovedByName: approved ? user.name : null,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
