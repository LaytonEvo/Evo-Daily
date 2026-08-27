import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { assertCronSecret, ApiError, errorResponse } from "@/lib/guards";
import {
  afternoonNudge,
  managerDigest,
  missAlerts,
  morningBrief,
} from "@/lib/nudges";

export const dynamic = "force-dynamic";

const JOBS = {
  "morning-brief": morningBrief,
  "afternoon-nudge": afternoonNudge,
  "manager-digest": managerDigest,
  "miss-alerts": missAlerts,
} as const;

/**
 * Railway cron, one schedule per nudge:
 *   morning-brief    30 8 * * 1-5   (London)
 *   afternoon-nudge   0 16 * * 1-5
 *   manager-digest    0 8 * * 1
 *   miss-alerts      20 0 * * *     (just after the sweep)
 *
 * Every job is a no-op when Slack is not configured.
 */
export async function POST(request: Request) {
  try {
    assertCronSecret(request);

    const job = new URL(request.url).searchParams.get("job");
    if (!job || !(job in JOBS)) {
      throw new ApiError(
        `Unknown nudge. Expected one of: ${Object.keys(JOBS).join(", ")}`,
        400,
      );
    }

    const result = await JOBS[job as keyof typeof JOBS](prisma);
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
