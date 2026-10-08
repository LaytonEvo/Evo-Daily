import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { todayInLondon } from "@/lib/time";

export const dynamic = "force-dynamic";

/**
 * Railway health check and the target for the external uptime monitor.
 * Confirms the database is reachable and reports today. Job health (missed
 * or failed runs) is on the admin Activity page, not here: a failed nightly
 * job shouldn't make Railway restart a healthy web service.
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, today: todayInLondon() });
  } catch {
    return NextResponse.json({ ok: false, error: "database_unreachable" }, { status: 503 });
  }
}
