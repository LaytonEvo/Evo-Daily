import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { errorResponse, requireApiUser, toActor } from "@/lib/guards";
import { deleteComment } from "@/lib/comments";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser();
    const { id } = await params;
    await deleteComment(prisma, id, toActor(user));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
