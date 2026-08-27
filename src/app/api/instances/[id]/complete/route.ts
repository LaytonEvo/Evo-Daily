import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { errorResponse, requireApiUser, toActor } from "@/lib/guards";
import { completeInstance, uncompleteInstance } from "@/lib/instances";

const completeSchema = z.object({
  note: z.string().trim().max(500).nullish(),
});

type Params = { params: Promise<{ id: string }> };

/** Tick a task. Members are gated to their own tasks inside the grace window. */
export async function POST(request: Request, { params }: Params) {
  try {
    const user = await requireApiUser();
    const { id } = await params;

    const raw = await request.json().catch(() => ({}));
    const { note } = completeSchema.parse(raw ?? {});

    const instance = await completeInstance(prisma, id, toActor(user), {
      ...(note !== undefined ? { note: note === "" ? null : (note ?? null) } : {}),
    });

    return NextResponse.json({
      id: instance.id,
      status: instance.status,
      wasLate: instance.wasLate,
      note: instance.note,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Untick a task — mis-tap recovery, inside the grace window. */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const user = await requireApiUser();
    const { id } = await params;
    const instance = await uncompleteInstance(prisma, id, toActor(user));
    return NextResponse.json({ id: instance.id, status: instance.status });
  } catch (error) {
    return errorResponse(error);
  }
}
