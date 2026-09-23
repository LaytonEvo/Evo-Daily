import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { errorResponse, requireApiUser } from "@/lib/guards";
import { unreadCountFor } from "@/lib/messages";

export const dynamic = "force-dynamic";

/**
 * What the nav badge says.
 *
 * Read from the client rather than passed down from each page, because a
 * reply can land while somebody is sitting on a screen, and a number rendered
 * once at request time would go stale the moment it mattered.
 */
export async function GET() {
  try {
    const user = await requireApiUser();
    return NextResponse.json({ unread: await unreadCountFor(prisma, user) });
  } catch (error) {
    return errorResponse(error);
  }
}
