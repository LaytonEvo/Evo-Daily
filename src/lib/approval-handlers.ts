/**
 * What happens when an approval is decided, per kind of item.
 *
 * Each module registers its item types here. The approvals service owns the
 * decision and the exactly-once guarantee; the handler only does the module's
 * action, and should itself be idempotent where the outside world allows.
 */

import type { Approval, PrismaClient } from "@prisma/client";
import { runJob } from "./job-runs";

export type EditableField = { key: string; label: string; multiline?: boolean };

export type ApprovalHandler = {
  /** Shown on the card above the buttons. */
  label: string;
  /** Payload fields a person may change before approving. */
  editable?: EditableField[];
  /** The module's action. `payload` already has any edits merged in. */
  onApprove: (ctx: { db: PrismaClient; approval: Approval; payload: Record<string, unknown> }) => Promise<Record<string, unknown> | void>;
};

const HANDLERS: Record<string, ApprovalHandler> = {
  /**
   * The Phase 2 gate: an approval that does nothing external, so the whole
   * path — raise, review, edit, approve exactly once — can be proven safely.
   */
  "hub:test": {
    label: "Test approval",
    editable: [{ key: "message", label: "Message", multiline: true }],
    onApprove: async ({ db, approval, payload }) => {
      await runJob(db, { module: "hub", name: "hub.test-approval", trigger: "manual" }, async () => ({
        message: `Test approval "${approval.title}" carried out`,
        details: { approvalId: approval.id, message: payload.message ?? null },
      }));
      return { carriedOut: true };
    },
  },
};

/** Modules register their item types at import time: registerApprovalHandler("finance", "bill", {...}). */
export function registerApprovalHandler(module: string, itemType: string, handler: ApprovalHandler) {
  HANDLERS[`${module}:${itemType}`] = handler;
}

export function handlerFor(module: string, itemType: string): ApprovalHandler | undefined {
  return HANDLERS[`${module}:${itemType}`];
}

export function registeredItemTypes(): string[] {
  return Object.keys(HANDLERS);
}
