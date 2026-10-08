import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { errorResponse } from "@/lib/guards";
import { assertCronSecret } from "@/lib/cron-auth";
import { runRegisteredJob } from "@/lib/job-registry";

export const dynamic = "force-dynamic";

/**
 * Railway cron, 00:15 London daily. Idempotent — a second run changes nothing.
 * Miss alerts fire on the sweep (see the job registry), so a manager hears
 * about a run of misses the morning it becomes three.
 */
export async function POST(request: Request) {
  try {
    assertCronSecret(request);
    return NextResponse.json(await runRegisteredJob(prisma, "tasks.sweep", "schedule"));
  } catch (error) {
    return errorResponse(error);
  }
}
