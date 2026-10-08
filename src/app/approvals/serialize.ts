import type { Approval } from "@prisma/client";
import { handlerFor } from "@/lib/approval-handlers";
import { STALE_AFTER_MS } from "@/lib/approvals";
import { moduleLabel } from "@/lib/hub";
import type { ApprovalCardData } from "./approval-card";

export function waitingLabel(since: Date, now = new Date()): string {
  const hours = Math.floor((now.getTime() - since.getTime()) / 3_600_000);
  if (hours < 1) return "under an hour";
  if (hours < 48) return `${hours} h`;
  return `${Math.floor(hours / 24)} days`;
}

export function toCard(approval: Approval & { assignee?: { name: string } | null }, now = new Date()): ApprovalCardData {
  const handler = handlerFor(approval.module, approval.itemType);
  const payload = (approval.payload ?? {}) as Record<string, unknown>;
  return {
    id: approval.id,
    title: approval.title,
    moduleLabel: approval.module === "hub" ? "Hub" : moduleLabel(approval.module),
    typeLabel: handler?.label ?? approval.itemType,
    summary: approval.summary,
    previewUrl: approval.previewUrl,
    waiting: waitingLabel(approval.createdAt, now),
    stale: now.getTime() - approval.createdAt.getTime() > STALE_AFTER_MS,
    assigneeName: approval.assignee?.name ?? null,
    fields: (handler?.editable ?? []).map((f) => ({
      ...f,
      value: payload[f.key] == null ? "" : String(payload[f.key]),
    })),
  };
}
