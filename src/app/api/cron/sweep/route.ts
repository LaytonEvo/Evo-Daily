import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { assertCronSecret, errorResponse } from "@/lib/guards";
import { runSweepJob } from "@/lib/jobs";
import { missAlerts } from "@/lib/nudges";

export const dynamic = "force-dynamic";

/** Railway cron, 00:15 London daily. Idempotent — a second run changes nothing. */
export async function POST(request: Request) {
  try {
    assertCronSecret(request);
    const result = await runSweepJob(prisma);
    // Miss alerts fire on the sweep, so a manager hears about a run of misses
    // the morning it becomes three. A Slack outage must not fail the sweep.
    const alerts = await missAlerts(prisma);
    return NextResponse.json({ ...result, alerts });
  } catch (error) {
    return errorResponse(error);
  }
}
