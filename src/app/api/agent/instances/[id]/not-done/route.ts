import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { errorResponse, requireAgent, toActor } from "@/lib/guards";
import { markNotDone } from "@/lib/instances";

const schema = z.object({ reason: z.string().trim().min(1).max(500) });

/**
 * Write a task off as not done.
 *
 * The reason is required here for the same purpose it is required of a person:
 * a miss with no explanation is what makes a report arguable three weeks on.
 * An agent writing one off without saying why would be worse than a person
 * doing it, not better.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const agent = await requireAgent(request);
    const { id } = await params;
    const { reason } = schema.parse(await request.json());

    const instance = await markNotDone(prisma, id, toActor(agent), reason);
    return NextResponse.json({ id: instance.id, status: instance.status, note: instance.note });
  } catch (error) {
    return errorResponse(error);
  }
}
