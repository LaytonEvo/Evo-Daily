import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { addComment, listComments } from "@/lib/comments";
import { errorResponse, requireAgent, toActor } from "@/lib/guards";

const schema = z.object({
  body: z.string().trim().min(1).max(5000),
  /**
   * Whose words these are. Supplied when the agent is relaying a reply
   * somebody dictated, so the thread can say "Layton (via Claude)" instead of
   * putting his words in the bot's mouth or the bot's typing under his name.
   */
  onBehalfOf: z.string().trim().optional(),
});

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const agent = await requireAgent(request);
    const { id } = await params;
    return NextResponse.json({ comments: await listComments(prisma, id, toActor(agent)) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const agent = await requireAgent(request);
    const { id } = await params;
    const input = schema.parse(await request.json());

    let onBehalfOfId: string | undefined;
    if (input.onBehalfOf) {
      // Resolved against this organisation, so a stray id cannot hang somebody
      // else's name on a comment.
      const person = await prisma.user.findFirst({
        where: { organisationId: agent.organisationId, id: input.onBehalfOf },
        select: { id: true },
      });
      if (!person) return NextResponse.json({ error: "No such person" }, { status: 422 });
      onBehalfOfId = person.id;
    }

    const comment = await addComment(prisma, id, toActor(agent), input.body, onBehalfOfId);
    return NextResponse.json({ id: comment.id, createdAt: comment.createdAt });
  } catch (error) {
    return errorResponse(error);
  }
}
