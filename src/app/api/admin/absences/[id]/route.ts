import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { errorResponse, requireApiAdmin, toActor } from "@/lib/guards";
import { deleteAbsence } from "@/lib/absences";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireApiAdmin();
    const { id } = await params;
    const result = await deleteAbsence(prisma, toActor(admin), id);
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
