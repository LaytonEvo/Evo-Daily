import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { errorResponse, requireApiAdmin } from "@/lib/guards";
import { categoryUpdateSchema, deleteCategory, updateCategory } from "@/lib/categories";

type Params = { params: Promise<{ id: string }> };

/** Rename, recolour, reorder, or retire. */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const admin = await requireApiAdmin();
    const { id } = await params;
    const input = categoryUpdateSchema.parse(await request.json());
    const category = await updateCategory(prisma, admin.organisationId, id, input);
    return NextResponse.json({
      id: category.id,
      name: category.name,
      colour: category.colour,
      isActive: category.isActive,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Only permitted while nothing references it; otherwise retire it instead. */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const admin = await requireApiAdmin();
    const { id } = await params;
    const removed = await deleteCategory(prisma, admin.organisationId, id);
    return NextResponse.json({ id: removed.id, deleted: true });
  } catch (error) {
    return errorResponse(error);
  }
}
