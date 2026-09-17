/**
 * Comments on a task occurrence, and the files attached to them.
 *
 * Access follows the instance, not the comment: if you can see the task you can
 * see its thread, and a member can only see their own tasks. That check is
 * re-run on every call rather than trusted from the last one, because comment
 * and attachment ids travel through the client.
 *
 * Deleting is author-or-admin. Editing is not offered at all — a thread that
 * can be rewritten is worth less as a record than one that cannot, and this
 * exists to explain misses after the fact.
 */

import { Role, type Prisma, type PrismaClient } from "@prisma/client";
import { ApiError } from "./errors";
import type { Actor } from "./instances";
import {
  ALLOWED_CONTENT_TYPES,
  MAX_ATTACHMENT_BYTES,
  buildStorageKey,
  deleteObject,
  presignDownload,
  presignUpload,
  storageEnabled,
} from "./storage";

type DbClient = PrismaClient | Prisma.TransactionClient;

export const MAX_COMMENT_LENGTH = 2000;

/**
 * The instance, if this actor is allowed to touch it. Mirrors the rule in
 * lib/instances: an unauthorised id is indistinguishable from a missing one,
 * so a member cannot learn that another person's task exists.
 */
async function instanceFor(db: DbClient, instanceId: string, actor: Actor) {
  const instance = await db.taskInstance.findUnique({
    where: { id: instanceId },
    select: { id: true, organisationId: true, assigneeId: true },
  });

  if (!instance || instance.organisationId !== actor.organisationId) {
    throw new ApiError("Task not found", 404);
  }
  if (actor.role !== Role.ADMIN && instance.assigneeId !== actor.id) {
    throw new ApiError("Task not found", 404);
  }
  return instance;
}

export async function listComments(db: DbClient, instanceId: string, actor: Actor) {
  await instanceFor(db, instanceId, actor);

  const comments = await db.comment.findMany({
    where: { instanceId },
    orderBy: { createdAt: "asc" },
    include: {
      author: { select: { id: true, name: true } },
      attachments: {
        select: { id: true, filename: true, contentType: true, bytes: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  return comments.map((c) => ({
    id: c.id,
    body: c.body,
    createdAt: c.createdAt,
    author: c.author,
    mine: c.authorId === actor.id,
    attachments: c.attachments,
  }));
}

export async function addComment(
  db: DbClient,
  instanceId: string,
  actor: Actor,
  body: string,
) {
  const instance = await instanceFor(db, instanceId, actor);

  const text = body.trim();
  if (!text) throw new ApiError("Write something first", 422);
  if (text.length > MAX_COMMENT_LENGTH) {
    throw new ApiError(`Keep it under ${MAX_COMMENT_LENGTH} characters`, 422);
  }

  return db.comment.create({
    data: {
      organisationId: instance.organisationId,
      instanceId: instance.id,
      authorId: actor.id,
      body: text,
    },
  });
}

/** The author, or any admin. */
async function commentFor(db: DbClient, commentId: string, actor: Actor) {
  const comment = await db.comment.findUnique({
    where: { id: commentId },
    select: { id: true, organisationId: true, authorId: true, instanceId: true },
  });
  if (!comment || comment.organisationId !== actor.organisationId) {
    throw new ApiError("Comment not found", 404);
  }
  // Re-check the instance too: an admin demoted since the comment was written
  // should lose access with it.
  await instanceFor(db, comment.instanceId, actor);
  return comment;
}

export async function deleteComment(db: DbClient, commentId: string, actor: Actor) {
  const comment = await commentFor(db, commentId, actor);
  if (actor.role !== Role.ADMIN && comment.authorId !== actor.id) {
    throw new ApiError("You can only delete your own comments", 403);
  }

  const attachments = await db.attachment.findMany({
    where: { commentId: comment.id },
    select: { storageKey: true },
  });

  await db.comment.delete({ where: { id: comment.id } });

  // After the row is gone, so a storage outage cannot leave the comment
  // undeletable. The worst case is an object nobody references.
  for (const a of attachments) await deleteObject(a.storageKey);
}

/**
 * Step one of an upload: check the file is allowed, reserve a key, hand back a
 * URL the browser can PUT to. The row is not written until the bytes land.
 */
export async function startAttachmentUpload(
  db: DbClient,
  commentId: string,
  actor: Actor,
  file: { filename: string; contentType: string; bytes: number },
) {
  if (!storageEnabled()) {
    throw new ApiError("Attachments are not switched on for this workspace", 503);
  }

  const comment = await commentFor(db, commentId, actor);
  if (actor.role !== Role.ADMIN && comment.authorId !== actor.id) {
    throw new ApiError("You can only attach files to your own comments", 403);
  }

  if (!ALLOWED_CONTENT_TYPES.has(file.contentType)) {
    throw new ApiError(`${file.contentType} files are not accepted`, 422);
  }
  if (file.bytes <= 0 || file.bytes > MAX_ATTACHMENT_BYTES) {
    throw new ApiError(
      `Files must be under ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)}MB`,
      422,
    );
  }

  const storageKey = buildStorageKey(comment.organisationId, file.filename);
  const uploadUrl = await presignUpload(storageKey, file.contentType);
  return { storageKey, uploadUrl };
}

/** Step two: the bytes are in the bucket, record them. */
export async function finishAttachmentUpload(
  db: DbClient,
  commentId: string,
  actor: Actor,
  file: { storageKey: string; filename: string; contentType: string; bytes: number },
) {
  const comment = await commentFor(db, commentId, actor);
  if (actor.role !== Role.ADMIN && comment.authorId !== actor.id) {
    throw new ApiError("You can only attach files to your own comments", 403);
  }
  // The key was minted by startAttachmentUpload for this organisation. Anything
  // else is a client inventing a path.
  if (!file.storageKey.startsWith(`${comment.organisationId}/`)) {
    throw new ApiError("Invalid upload", 422);
  }
  if (!ALLOWED_CONTENT_TYPES.has(file.contentType)) {
    throw new ApiError(`${file.contentType} files are not accepted`, 422);
  }
  if (file.bytes <= 0 || file.bytes > MAX_ATTACHMENT_BYTES) {
    throw new ApiError("That file is too large", 422);
  }

  return db.attachment.create({
    data: {
      organisationId: comment.organisationId,
      commentId: comment.id,
      storageKey: file.storageKey,
      filename: file.filename.slice(0, 200),
      contentType: file.contentType,
      bytes: file.bytes,
      uploadedById: actor.id,
    },
  });
}

/** A short-lived download link, once the caller is shown to be allowed it. */
export async function attachmentDownloadUrl(
  db: DbClient,
  attachmentId: string,
  actor: Actor,
): Promise<string> {
  if (!storageEnabled()) throw new ApiError("Attachments are not switched on", 503);

  const attachment = await db.attachment.findUnique({
    where: { id: attachmentId },
    select: {
      storageKey: true,
      filename: true,
      organisationId: true,
      comment: { select: { instanceId: true } },
    },
  });
  if (!attachment || attachment.organisationId !== actor.organisationId) {
    throw new ApiError("File not found", 404);
  }
  // The instance decides, same as everywhere else.
  await instanceFor(db, attachment.comment.instanceId, actor);

  return presignDownload(attachment.storageKey, attachment.filename);
}
