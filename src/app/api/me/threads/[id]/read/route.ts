import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { errorResponse, requireApiUser } from "@/lib/guards";
import { markThreadRead } from "@/lib/messages";

/** Mark one thread read up to now. Only a thread the caller is actually in. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser();
    const { id } = await params;
    const marked = await markThreadRead(prisma, user, id);
    if (!marked) return NextResponse.json({ error: "Thread not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
