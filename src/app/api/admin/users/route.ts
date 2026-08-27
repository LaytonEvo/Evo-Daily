import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { errorResponse, requireApiAdmin } from "@/lib/guards";
import { createUser, createUserSchema } from "@/lib/users";

export async function POST(request: Request) {
  try {
    const admin = await requireApiAdmin();
    const input = createUserSchema.parse(await request.json());
    const user = await createUser(prisma, admin.organisationId, input);
    return NextResponse.json({ id: user.id }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
