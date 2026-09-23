import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { saveDayCheck } from "@/lib/day-check";
import { errorResponse, requireApiUser } from "@/lib/guards";

/** Answer yesterday's under-half question. */
export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const body = (await request.json().catch(() => ({}))) as { reason?: unknown };
    const reason = typeof body.reason === "string" ? body.reason : "";

    const result = await saveDayCheck(prisma, user, reason);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 422 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
