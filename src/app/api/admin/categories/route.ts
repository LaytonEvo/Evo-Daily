import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { errorResponse, requireApiAdmin } from "@/lib/guards";
import { categoryInputSchema, createCategory } from "@/lib/categories";

export async function POST(request: Request) {
  try {
    const admin = await requireApiAdmin();
    const input = categoryInputSchema.parse(await request.json());
    const category = await createCategory(prisma, admin.organisationId, input);
    return NextResponse.json({ id: category.id }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
