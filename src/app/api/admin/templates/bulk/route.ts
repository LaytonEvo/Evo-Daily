import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { errorResponse, requireApiAdmin } from "@/lib/guards";
import {
  bulkChangesSchema,
  deleteImpact,
  deleteTemplates,
  reassignTemplates,
  updateTemplates,
} from "@/lib/templates";

const reassignSchema = z.object({
  action: z.literal("reassign"),
  templateIds: z.array(z.string()).min(1),
  assigneeId: z.string().min(1),
});

const updateSchema = z.object({
  action: z.literal("update"),
  templateIds: z.array(z.string()).min(1),
  changes: bulkChangesSchema,
});

const deleteSchema = z.object({
  action: z.literal("delete"),
  templateIds: z.array(z.string()).min(1),
  /** Only ever sent after the admin has been shown what it costs. */
  force: z.boolean().optional(),
});

/** Read-only: what a delete would remove. Nothing is written. */
const impactSchema = z.object({
  action: z.literal("impact"),
  templateIds: z.array(z.string()).min(1),
});

const schema = z.discriminatedUnion("action", [
  reassignSchema,
  updateSchema,
  deleteSchema,
  impactSchema,
]);

/**
 * Bulk edits. Future instances only, exactly as a single edit is.
 *
 * "reassign" predates this and is kept as its own action rather than folded
 * into "update": it is one request from a dropdown, it needs no confirmation,
 * and routing it through the general path would make the common case carry the
 * general case's ceremony.
 */
export async function POST(request: Request) {
  try {
    const admin = await requireApiAdmin();
    const body = schema.parse(await request.json());

    if (body.action === "reassign") {
      const count = await reassignTemplates(
        prisma,
        admin.organisationId,
        body.templateIds,
        body.assigneeId,
      );
      return NextResponse.json({ reassigned: count });
    }

    if (body.action === "impact") {
      const impacts = await deleteImpact(prisma, admin.organisationId, body.templateIds);
      return NextResponse.json({ impacts });
    }

    if (body.action === "delete") {
      const result = await deleteTemplates(prisma, admin.organisationId, body.templateIds, {
        force: body.force ?? false,
      });
      return NextResponse.json(result);
    }

    const result = await updateTemplates(
      prisma,
      admin.organisationId,
      body.templateIds,
      body.changes,
    );
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
