import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { errorResponse, requireApiUser, toActor } from "@/lib/guards";
import { setInstanceNote } from "@/lib/instances";

const schema = z.object({ note: z.string().trim().max(500).nullable() });

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser();
    const { id } = await params;
    const { note } = schema.parse(await request.json());
    const instance = await setInstanceNote(prisma, id, toActor(user), note === "" ? null : note);
    return NextResponse.json({ id: instance.id, note: instance.note });
  } catch (error) {
    return errorResponse(error);
  }
}
