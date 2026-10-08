import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError, errorResponse, requireApiModule } from "@/lib/guards";
import { getJob, runRegisteredJob } from "@/lib/job-registry";

export const dynamic = "force-dynamic";

/**
 * "Run now" on the Activity page. Every job is idempotent, so a manual run on
 * top of tonight's scheduled one changes nothing it shouldn't. A failure is
 * answered as 200 with the failure in the body: the run itself worked, and its
 * outcome is in the activity log either way.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  try {
    await requireApiModule("activity");
    const { name } = await params;
    if (!getJob(name)) throw new ApiError("Unknown job", 404);
    try {
      const outcome = await runRegisteredJob(prisma, name, "manual");
      return NextResponse.json({ ok: true, outcome });
    } catch (error) {
      return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  } catch (error) {
    return errorResponse(error);
  }
}
