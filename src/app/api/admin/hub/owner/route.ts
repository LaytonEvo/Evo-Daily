import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, errorResponse, requireApiAdmin } from "@/lib/guards";
import { setSetting } from "@/lib/hub-settings";

const schema = z.object({ userId: z.string().min(1) });

/** Who looks after day-to-day hub health and gets its tasks. */
export async function POST(request: Request) {
  try {
    const admin = await requireApiAdmin();
    const { userId } = schema.parse(await request.json());
    const user = await prisma.user.findFirst({ where: { id: userId, isActive: true } });
    if (!user) throw new ApiError("That person isn't active", 422);
    await setSetting(prisma, "hub.ownerId", userId, { userId: admin.id });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
