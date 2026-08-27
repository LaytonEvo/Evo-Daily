import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { assertCronSecret, errorResponse } from "@/lib/guards";
import { runGenerateJob } from "@/lib/jobs";

export const dynamic = "force-dynamic";

/** Railway cron, 00:05 London daily. Idempotent. */
export async function POST(request: Request) {
  try {
    assertCronSecret(request);
    const result = await runGenerateJob(prisma);
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
