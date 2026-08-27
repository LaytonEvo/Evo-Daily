import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { errorResponse, requireApiAdmin } from "@/lib/guards";

const schema = z.object({
  name: z.string().trim().min(1).max(60),
  colour: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #2563eb"),
  sortOrder: z.number().int().min(0).default(0),
});

export async function POST(request: Request) {
  try {
    const admin = await requireApiAdmin();
    const input = schema.parse(await request.json());
    const category = await prisma.category.create({
      data: { organisationId: admin.organisationId, ...input },
    });
    return NextResponse.json({ id: category.id }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
