import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError, errorResponse } from "@/lib/guards";
import { assertCronSecret } from "@/lib/cron-auth";
import { isNudgeJob, nudgeNames, runNudge } from "@/lib/nudge-jobs";

export const dynamic = "force-dynamic";

/**
 * Railway cron, one schedule per nudge. The times are UTC, because Railway has
 * no per-service timezone, and the London times they are meant to land at hold
 * only in summer:
 *
 *   morning-brief    30 7 * * 1-5   (08:30 London in BST)
 *   afternoon-nudge   0 15 * * 1-5  (16:00)
 *   manager-digest    0 7 * * 1     (08:00 Monday)
 *   miss-alerts      20 0 * * *     (just after the sweep)
 *
 * Every job is a no-op when Slack is not configured.
 *
 * The deployed cron services call the path form in ./[job] instead — see the
 * note there. This form stays for cron.sh and anything else already using it.
 */
export async function POST(request: Request) {
  try {
    assertCronSecret(request);

    const job = new URL(request.url).searchParams.get("job");
    if (!isNudgeJob(job)) {
      throw new ApiError(`Unknown nudge. Expected one of: ${nudgeNames()}`, 400);
    }

    return NextResponse.json(await runNudge(job, prisma));
  } catch (error) {
    return errorResponse(error);
  }
}
