import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { todayInLondon } from "@/lib/time";

export const dynamic = "force-dynamic";

/** Railway health check. Confirms the database is reachable and reports today. */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, today: todayInLondon() });
  } catch {
    return NextResponse.json({ ok: false, error: "database_unreachable" }, { status: 503 });
  }
}
