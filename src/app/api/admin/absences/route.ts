import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { errorResponse, requireApiAdmin, toActor } from "@/lib/guards";
import { createAbsence, listAbsences } from "@/lib/absences";
import { isDateOnly } from "@/lib/time";

const dateOnly = z.string().refine(isDateOnly, "Expected YYYY-MM-DD");

const schema = z.object({
  userId: z.string().min(1),
  from: dateOnly,
  to: dateOnly,
  reason: z.string().trim().max(200).nullish(),
  coverUserId: z.string().min(1).nullish(),
});

export async function GET() {
  try {
    const admin = await requireApiAdmin();
    return NextResponse.json({ absences: await listAbsences(prisma, admin.organisationId) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireApiAdmin();
    const input = schema.parse(await request.json());
    const result = await createAbsence(prisma, toActor(admin), {
      userId: input.userId,
      from: input.from,
      to: input.to,
      reason: input.reason ?? null,
      coverUserId: input.coverUserId ?? null,
    });
    return NextResponse.json(
      { id: result.absence.id, ...result.applied },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
