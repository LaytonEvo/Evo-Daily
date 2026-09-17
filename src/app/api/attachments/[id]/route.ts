import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { errorResponse, requireApiUser, toActor } from "@/lib/guards";
import { attachmentDownloadUrl } from "@/lib/comments";

/**
 * Redirect to a short-lived signed URL rather than streaming the bytes: the
 * file comes from the bucket, not from this server.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser();
    const { id } = await params;
    const url = await attachmentDownloadUrl(prisma, id, toActor(user));
    return NextResponse.redirect(url, { status: 302 });
  } catch (error) {
    return errorResponse(error);
  }
}
