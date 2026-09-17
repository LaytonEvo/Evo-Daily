import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { errorResponse, requireApiAdmin, toActor } from "@/lib/guards";
import { markNotDone } from "@/lib/instances";

const schema = z.object({ reason: z.string().trim().min(1).max(500) });

/** Write a task off as not done. Admins only; the service checks again. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiAdmin();
    const { id } = await params;
    const { reason } = schema.parse(await request.json());

    const instance = await markNotDone(prisma, id, toActor(user), reason);

    return NextResponse.json({
      id: instance.id,
      status: instance.status,
      note: instance.note,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
