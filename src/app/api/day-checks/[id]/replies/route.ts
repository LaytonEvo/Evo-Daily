import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { errorResponse, requireApiUser } from "@/lib/guards";
import { replyToDayCheck } from "@/lib/messages";

/** Reply to an under-half answer. The person it is about, and the admins. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser();
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { body?: unknown };
    const text = typeof body.body === "string" ? body.body : "";

    const sent = await replyToDayCheck(prisma, user, id, text);
    if (!sent) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
