import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { errorResponse, requireApiAdmin } from "@/lib/guards";
import {
  deleteTemplate,
  duplicateTemplate,
  setTemplateActive,
  templateInputSchema,
  updateTemplate,
} from "@/lib/templates";

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Params) {
  try {
    const admin = await requireApiAdmin();
    const { id } = await params;
    const input = templateInputSchema.parse(await request.json());
    const template = await updateTemplate(prisma, admin.organisationId, id, input);
    return NextResponse.json({ id: template.id });
  } catch (error) {
    return errorResponse(error);
  }
}

const patchSchema = z.object({
  isActive: z.boolean().optional(),
  duplicate: z.literal(true).optional(),
});

/** Toggle active, or duplicate. */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const admin = await requireApiAdmin();
    const { id } = await params;
    const body = patchSchema.parse(await request.json());

    if (body.duplicate) {
      const copy = await duplicateTemplate(prisma, admin.organisationId, id, admin.id);
      return NextResponse.json({ id: copy.id, duplicated: true }, { status: 201 });
    }

    if (body.isActive !== undefined) {
      const template = await setTemplateActive(
        prisma,
        admin.organisationId,
        id,
        body.isActive,
      );
      return NextResponse.json({ id: template.id, isActive: template.isActive });
    }

    return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Only for a task with no record. Anything else comes back 409. */
export async function DELETE(_request: Request, { params }: Params) {
  try {
    const admin = await requireApiAdmin();
    const { id } = await params;
    const template = await deleteTemplate(prisma, admin.organisationId, id);
    return NextResponse.json({ id: template.id, deleted: true });
  } catch (error) {
    return errorResponse(error);
  }
}
