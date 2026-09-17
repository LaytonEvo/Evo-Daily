import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { errorResponse, requireApiUser, toActor } from "@/lib/guards";
import { addComment, listComments, MAX_COMMENT_LENGTH } from "@/lib/comments";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const user = await requireApiUser();
    const { id } = await params;
    return NextResponse.json({ comments: await listComments(prisma, id, toActor(user)) });
  } catch (error) {
    return errorResponse(error);
  }
}

const schema = z.object({ body: z.string().trim().min(1).max(MAX_COMMENT_LENGTH) });

export async function POST(request: Request, { params }: Params) {
  try {
    const user = await requireApiUser();
    const { id } = await params;
    const { body } = schema.parse(await request.json());
    const comment = await addComment(prisma, id, toActor(user), body);
    return NextResponse.json({ id: comment.id }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
