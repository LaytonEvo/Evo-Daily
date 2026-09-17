import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { errorResponse, requireApiUser, toActor } from "@/lib/guards";
import { finishAttachmentUpload, startAttachmentUpload } from "@/lib/comments";

type Params = { params: Promise<{ id: string }> };

const startSchema = z.object({
  filename: z.string().trim().min(1).max(200),
  contentType: z.string().trim().min(1).max(100),
  bytes: z.number().int().positive(),
});

/** Step one: get a URL the browser can upload straight to the bucket with. */
export async function POST(request: Request, { params }: Params) {
  try {
    const user = await requireApiUser();
    const { id } = await params;
    const file = startSchema.parse(await request.json());
    const result = await startAttachmentUpload(prisma, id, toActor(user), file);
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}

const finishSchema = startSchema.extend({ storageKey: z.string().trim().min(1).max(300) });

/** Step two: the bytes are up, record the file. */
export async function PUT(request: Request, { params }: Params) {
  try {
    const user = await requireApiUser();
    const { id } = await params;
    const file = finishSchema.parse(await request.json());
    const attachment = await finishAttachmentUpload(prisma, id, toActor(user), file);
    return NextResponse.json({
      id: attachment.id,
      filename: attachment.filename,
      contentType: attachment.contentType,
      bytes: attachment.bytes,
    }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
