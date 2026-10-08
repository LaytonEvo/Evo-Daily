import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { errorResponse } from "@/lib/guards";
import { assertCronSecret } from "@/lib/cron-auth";
import { runRegisteredJob } from "@/lib/job-registry";

export const dynamic = "force-dynamic";

/** Railway cron, 00:05 London daily. Idempotent. Logged to the activity log. */
export async function POST(request: Request) {
  try {
    assertCronSecret(request);
    return NextResponse.json(await runRegisteredJob(prisma, "tasks.generate", "schedule"));
  } catch (error) {
    return errorResponse(error);
  }
}
