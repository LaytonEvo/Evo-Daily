/**
 * The approvals inbox: one queue for everything that needs a person's
 * sign-off before a module acts.
 *
 *   pending ──approve──▶ approved ──▶ module action runs, once
 *          ├─reject───▶ rejected  (with a rework task when asked for)
 *          └─expires──▶ expired
 *
 * Exactly once, twice over: the decision is an update that only matches a
 * PENDING row, and the action is claimed by setting executedAt on an
 * APPROVED row that has none. Two clicks, two tabs or two people all reach
 * the database, and only one of each update can win.
 */

import { ApprovalStatus, Prisma, Role, type Approval, type PrismaClient } from "@prisma/client";
import { ApiError } from "./errors";
import { handlerFor } from "./approval-handlers";
import { automationEnabled, hubOwnerId } from "./hub-settings";
import { createTask } from "./create-task";
import { runJob } from "./job-runs";
import { todayInLondon } from "./time";

/** Approvals waiting longer than this are flagged on the home screen. */
export const STALE_AFTER_MS = 48 * 60 * 60 * 1000;

type Viewer = { id: string; role: Role; moduleAccess: string[] };

export type RequestApprovalInput = {
  module: string;
  itemType: string;
  title: string;
  summary: string;
  payload?: Record<string, unknown>;
  previewUrl?: string | null;
  assigneeId?: string | null;
  requestedById?: string | null;
  sourceRef?: string | null;
  expiresAt?: Date | null;
  organisationId?: string;
};

/**
 * Raise an approval. With a sourceRef the call is idempotent: while one for
 * the same item is still pending, that one is returned instead.
 */
export async function requestApproval(db: PrismaClient, input: RequestApprovalInput) {
  if (!handlerFor(input.module, input.itemType)) {
    throw new ApiError(`No handler registered for ${input.module}:${input.itemType}`, 422);
  }
  const organisationId =
    input.organisationId ?? (await db.organisation.findFirstOrThrow({ orderBy: { createdAt: "asc" } })).id;

  const data = {
    organisationId,
    module: input.module,
    itemType: input.itemType,
    title: input.title,
    summary: input.summary,
    payload: (input.payload ?? {}) as Prisma.InputJsonValue,
    previewUrl: input.previewUrl ?? null,
    assigneeId: input.assigneeId ?? null,
    requestedById: input.requestedById ?? null,
    sourceRef: input.sourceRef ?? null,
    expiresAt: input.expiresAt ?? null,
  };

  if (!input.sourceRef) return { approval: await db.approval.create({ data }), created: true };

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`approval:${input.module}:${input.sourceRef}`}))`;
    const existing = await tx.approval.findFirst({
      where: { module: input.module, sourceRef: input.sourceRef, status: ApprovalStatus.PENDING },
    });
    if (existing) return { approval: existing, created: false };
    return { approval: await tx.approval.create({ data }), created: true };
  });
}

/** Admins decide anything; managers anything in their modules; others what is assigned to them. */
export function canDecide(viewer: Viewer, approval: Pick<Approval, "assigneeId" | "module">): boolean {
  if (viewer.role === Role.ADMIN) return true;
  if (approval.assigneeId === viewer.id) return true;
  return viewer.role === Role.MANAGER && viewer.moduleAccess.includes(approval.module);
}

export function canView(viewer: Viewer, approval: Pick<Approval, "assigneeId" | "module" | "requestedById">) {
  return canDecide(viewer, approval) || approval.requestedById === viewer.id;
}

/** The approvals a person may decide, as a Prisma filter. */
export function decidableWhere(viewer: Viewer): Prisma.ApprovalWhereInput {
  if (viewer.role === Role.ADMIN) return {};
  const or: Prisma.ApprovalWhereInput[] = [{ assigneeId: viewer.id }];
  if (viewer.role === Role.MANAGER && viewer.moduleAccess.length > 0) {
    or.push({ module: { in: viewer.moduleAccess } });
  }
  return { OR: or };
}

export function pendingFor(db: PrismaClient, viewer: Viewer, options: { module?: string; mineOnly?: boolean } = {}) {
  return db.approval.findMany({
    where: {
      status: ApprovalStatus.PENDING,
      ...decidableWhere(viewer),
      ...(options.module ? { module: options.module } : {}),
      ...(options.mineOnly ? { assigneeId: viewer.id } : {}),
    },
    include: { assignee: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
}

export async function pendingCounts(db: PrismaClient, viewer: Viewer, now = new Date()) {
  const where = { status: ApprovalStatus.PENDING, ...decidableWhere(viewer) };
  const [total, stale] = await Promise.all([
    db.approval.count({ where }),
    db.approval.count({ where: { ...where, createdAt: { lt: new Date(now.getTime() - STALE_AFTER_MS) } } }),
  ]);
  return { total, stale };
}

export type Decision = {
  decision: "approve" | "reject";
  note?: string | null;
  /** On reject: raise a task for whoever asked, to redo it. */
  rework?: boolean;
  /** On approve: changes to the handler's editable fields. */
  edits?: Record<string, string>;
};

export async function decideApproval(db: PrismaClient, viewer: Viewer, id: string, decision: Decision, now = new Date()) {
  const approval = await db.approval.findUnique({ where: { id } });
  if (!approval) throw new ApiError("Approval not found", 404);
  if (!canDecide(viewer, approval)) throw new ApiError("This one isn't yours to decide", 403);

  const handler = handlerFor(approval.module, approval.itemType);
  let edits: Record<string, string> | null = null;

  if (decision.decision === "approve") {
    if (!handler) throw new ApiError("Nothing knows how to carry this out", 422);
    if (!(await automationEnabled(db, approval.module))) {
      throw new ApiError(`Automation for ${approval.module} is paused, so nothing can be carried out. Reject it, or wait.`, 409);
    }
    const allowed = new Set((handler.editable ?? []).map((f) => f.key));
    const given = Object.entries(decision.edits ?? {});
    if (given.some(([k]) => !allowed.has(k))) throw new ApiError("That field can't be edited", 422);
    edits = given.length ? Object.fromEntries(given) : null;
  }

  const status = decision.decision === "approve" ? ApprovalStatus.APPROVED : ApprovalStatus.REJECTED;
  const { count } = await db.approval.updateMany({
    where: { id, status: ApprovalStatus.PENDING, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    data: {
      status,
      decidedById: viewer.id,
      decidedAt: now,
      decisionNote: decision.note?.trim() || null,
      edits: edits ?? Prisma.JsonNull,
      needsRework: decision.decision === "reject" && Boolean(decision.rework),
    },
  });

  if (count === 0) {
    // Somebody else got there first, or it expired. Not an error for a
    // double-click: say what happened and carry on.
    return { approval: await db.approval.findUniqueOrThrow({ where: { id } }), alreadyDecided: true };
  }

  if (status === ApprovalStatus.REJECTED && decision.rework) {
    const owner = approval.requestedById ?? (await hubOwnerId(db));
    if (owner) {
      await createTask(db, {
        title: `Rework: ${approval.title}`,
        description: decision.note?.trim() || "Rejected with a request to rework it.",
        assigneeId: owner,
        due: todayInLondon(now),
        sourceModule: approval.module,
        sourceRef: `/approvals/${approval.id}`,
        raisedById: viewer.id,
      });
    }
  }

  if (status === ApprovalStatus.APPROVED) await executeApproval(db, id);

  return { approval: await db.approval.findUniqueOrThrow({ where: { id } }), alreadyDecided: false };
}

/**
 * Carry out an approved item. Claims the run first, so however many callers
 * arrive only one does the work. Logged to the activity log like any job.
 */
export async function executeApproval(db: PrismaClient, id: string) {
  const { count } = await db.approval.updateMany({
    where: { id, status: ApprovalStatus.APPROVED, executedAt: null },
    data: { executedAt: new Date(), executionStatus: "running" },
  });
  if (count === 0) return;

  const approval = await db.approval.findUniqueOrThrow({ where: { id } });
  const handler = handlerFor(approval.module, approval.itemType)!;
  const payload = { ...(approval.payload as Record<string, unknown>), ...((approval.edits as Record<string, unknown>) ?? {}) };

  try {
    const result = await runJob(
      db,
      { module: approval.module, name: `approval.${approval.itemType}`, trigger: "manual" },
      async () => {
        const out = await handler.onApprove({ db, approval, payload });
        return { message: `Carried out "${approval.title}"`, details: { approvalId: id, ...(out ?? {}) } };
      },
    );
    await db.approval.update({
      where: { id },
      data: { executionStatus: "success", executionResult: (result.details ?? {}) as Prisma.InputJsonValue },
    });
  } catch (error) {
    await db.approval.update({
      where: { id },
      data: {
        executionStatus: "failed",
        executionResult: { error: error instanceof Error ? error.message : String(error) },
      },
    });
  }
}

/** Try a failed action again. Only a failed run can be released for a retry. */
export async function retryExecution(db: PrismaClient, viewer: Viewer, id: string) {
  const approval = await db.approval.findUnique({ where: { id } });
  if (!approval) throw new ApiError("Approval not found", 404);
  if (!canDecide(viewer, approval)) throw new ApiError("This one isn't yours to decide", 403);
  if (!(await automationEnabled(db, approval.module))) {
    throw new ApiError(`Automation for ${approval.module} is paused`, 409);
  }
  const { count } = await db.approval.updateMany({
    where: { id, status: ApprovalStatus.APPROVED, executionStatus: "failed" },
    data: { executedAt: null, executionStatus: null },
  });
  if (count > 0) await executeApproval(db, id);
  return db.approval.findUniqueOrThrow({ where: { id } });
}

/** Mark anything past its expiry as expired. */
export async function expireApprovals(db: PrismaClient, now = new Date()) {
  const { count } = await db.approval.updateMany({
    where: { status: ApprovalStatus.PENDING, expiresAt: { lte: now } },
    data: { status: ApprovalStatus.EXPIRED },
  });
  return count;
}
