import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { errorResponse, requireApiAdmin } from "@/lib/guards";
import { settingsInputSchema, updateSettings } from "@/lib/settings";

/** Org settings. Admins only, and the change takes effect on save. */
export async function PUT(request: Request) {
  try {
    const admin = await requireApiAdmin();
    const input = settingsInputSchema.parse(await request.json());
    const settings = await updateSettings(prisma, admin.organisationId, input);
    return NextResponse.json({ graceDays: settings.graceDays, swept: settings.swept });
  } catch (error) {
    return errorResponse(error);
  }
}
