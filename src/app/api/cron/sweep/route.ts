import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { assertCronSecret, errorResponse } from "@/lib/guards";
import { runSweepJob } from "@/lib/jobs";

export const dynamic = "force-dynamic";

/** Railway cron, 00:15 London daily. Idempotent — a second run changes nothing. */
export async function POST(request: Request) {
  try {
    assertCronSecret(request);
    const result = await runSweepJob(prisma);
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
