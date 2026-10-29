import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { errorResponse, requireAgent, toActor } from "@/lib/guards";
import { buildOverview } from "@/lib/overview";

export const dynamic = "force-dynamic";

/** Everything needed to answer "how are we doing", in one call. */
export async function GET(request: Request) {
  try {
    const agent = await requireAgent(request);
    const url = new URL(request.url);
    const days = url.searchParams.get("days");

    const overview = await buildOverview(prisma, toActor(agent), {
      days: days ? Number(days) : undefined,
    });
    return NextResponse.json(overview);
  } catch (error) {
    return errorResponse(error);
  }
}
