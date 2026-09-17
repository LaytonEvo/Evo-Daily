import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { errorResponse, requireApiAdmin } from "@/lib/guards";
import { describeSchedule } from "@/lib/recurrence";

/** The active recurring tasks one person owns — for choosing cover per task. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireApiAdmin();
    const { id } = await params;

    const templates = await prisma.taskTemplate.findMany({
      where: { organisationId: admin.organisationId, assigneeId: id, isActive: true },
      orderBy: { title: "asc" },
      include: { category: { select: { name: true, colour: true } } },
    });

    return NextResponse.json({
      templates: templates.map((t) => ({
        id: t.id,
        title: t.title,
        schedule: describeSchedule(t),
        categoryName: t.category?.name ?? null,
        categoryColour: t.category?.colour ?? null,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
