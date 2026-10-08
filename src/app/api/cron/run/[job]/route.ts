import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError, errorResponse } from "@/lib/guards";
import { assertCronSecret } from "@/lib/cron-auth";
import { getJob, runRegisteredJob } from "@/lib/job-registry";

export const dynamic = "force-dynamic";

/**
 * Run any registered job by name, for cron services added from the hub on:
 *
 *   POST /api/cron/run/hub.monitor     every 15 minutes
 *
 * The older routes (generate, sweep, nudge) stay as they are, because the
 * existing cron services already call them.
 */
export async function POST(request: Request, { params }: { params: Promise<{ job: string }> }) {
  try {
    assertCronSecret(request);
    const { job } = await params;
    if (!getJob(job)) throw new ApiError("Unknown job", 404);
    return NextResponse.json(await runRegisteredJob(prisma, job, "schedule"));
  } catch (error) {
    return errorResponse(error);
  }
}
