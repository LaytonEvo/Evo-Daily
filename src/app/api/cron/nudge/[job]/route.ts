import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError, errorResponse } from "@/lib/guards";
import { assertCronSecret } from "@/lib/cron-auth";
import { isNudgeJob, nudgeNames, runNudge } from "@/lib/nudge-jobs";

export const dynamic = "force-dynamic";

/**
 * The same jobs as ../route.ts, addressed by path instead of query string:
 *
 *   /api/cron/nudge/morning-brief
 *
 * Which exists because a Railway cron service is a curl image whose start
 * command is a single string, and a `?` in that string did not survive to
 * curl — it came back a usage error while the identical command without one
 * ran fine. Rather than keep guessing at the quoting, the two nudge services
 * now address the app exactly the way the generate and sweep services do,
 * which have run every night for weeks.
 *
 * The query-string form stays: cron.sh uses it, and so would anything else
 * already pointed at it.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ job: string }> },
) {
  try {
    assertCronSecret(_request);
    const { job } = await params;
    if (!isNudgeJob(job)) {
      throw new ApiError(`Unknown nudge. Expected one of: ${nudgeNames()}`, 400);
    }
    return NextResponse.json(await runNudge(job, prisma));
  } catch (error) {
    return errorResponse(error);
  }
}
