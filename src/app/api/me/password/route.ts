import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { hashPassword, MIN_PASSWORD_LENGTH } from "@/lib/auth";
import { ApiError, errorResponse, requireApiUser } from "@/lib/guards";

const schema = z.object({
  currentPassword: z.string().min(1),
  password: z.string().min(MIN_PASSWORD_LENGTH),
});

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    const body = schema.parse(await request.json());

    const record = await prisma.user.findUnique({ where: { id: user.id } });
    if (!record) throw new ApiError("Not signed in", 401);

    const ok = await bcrypt.compare(body.currentPassword, record.passwordHash);
    if (!ok) throw new ApiError("Your current password is not right.", 400);

    if (await bcrypt.compare(body.password, record.passwordHash)) {
      throw new ApiError("Pick a password you have not used here before.", 400);
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(body.password),
        mustChangePassword: false,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
