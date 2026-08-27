import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { errorResponse, requireApiAdmin } from "@/lib/guards";
import { createTemplate, templateInputSchema } from "@/lib/templates";

export async function POST(request: Request) {
  try {
    const admin = await requireApiAdmin();
    const input = templateInputSchema.parse(await request.json());
    const template = await createTemplate(prisma, admin.organisationId, admin.id, input);
    return NextResponse.json({ id: template.id }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
