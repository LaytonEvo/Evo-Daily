import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { errorResponse, requireApiAdmin } from "@/lib/guards";
import { updateUser, updateUserSchema } from "@/lib/users";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireApiAdmin();
    const { id } = await params;
    const input = updateUserSchema.parse(await request.json());
    const user = await updateUser(prisma, admin.organisationId, admin.id, id, input);
    return NextResponse.json({ id: user.id, isActive: user.isActive, role: user.role });
  } catch (error) {
    return errorResponse(error);
  }
}
