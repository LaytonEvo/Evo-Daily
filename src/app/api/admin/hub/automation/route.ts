import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { errorResponse, requireApiAdmin } from "@/lib/guards";
import { AUTOMATION_MODULES, setAutomation } from "@/lib/hub-settings";

const schema = z.object({
  module: z.enum([...AUTOMATION_MODULES, "global"]),
  enabled: z.boolean(),
  reason: z.string().trim().max(500).nullish(),
});

/** Kill switch. Instant, and kept with who and why. */
export async function POST(request: Request) {
  try {
    const admin = await requireApiAdmin();
    const input = schema.parse(await request.json());
    await setAutomation(prisma, input.module, input.enabled, { userId: admin.id, reason: input.reason });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
