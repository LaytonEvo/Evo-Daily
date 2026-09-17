import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
import {
  createTemplate,
  databaseAvailable,
  instancesFor,
  prisma,
  seedFixture,
  type Fixture,
} from "./helpers/db";
import { generateInstances } from "@/lib/recurrence";
import { todayInLondon } from "@/lib/time";

// The bucket is stubbed: these tests are about who may see and touch what,
// which is decided entirely in the database.
vi.mock("@/lib/storage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/storage")>("@/lib/storage");
  return {
    ...actual,
    storageEnabled: () => true,
    presignUpload: async () => "https://bucket.example/put",
    presignDownload: async () => "https://bucket.example/get",
    deleteObject: async () => undefined,
  };
});

const {
  addComment,
  listComments,
  deleteComment,
  startAttachmentUpload,
  finishAttachmentUpload,
  attachmentDownloadUrl,
} = await import("@/lib/comments");

const available = await databaseAvailable();
const describeDb = available ? describe : describe.skip;
const TODAY = todayInLondon();

describeDb("comments", () => {
  let fixture: Fixture;
  let mine: string;
  let theirs: string;

  const member = () => ({ id: fixture.memberId, role: Role.MEMBER, organisationId: fixture.orgId });
  const other = () => ({
    id: fixture.otherMemberId,
    role: Role.MEMBER,
    organisationId: fixture.orgId,
  });
  const admin = () => ({ id: fixture.adminId, role: Role.ADMIN, organisationId: fixture.orgId });

  beforeEach(async () => {
    fixture = await seedFixture();
    const a = await createTemplate(fixture, {
      title: "Mine",
      startDate: TODAY,
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
      assigneeId: fixture.memberId,
    });
    const b = await createTemplate(fixture, {
      title: "Theirs",
      startDate: TODAY,
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
      assigneeId: fixture.otherMemberId,
    });
    await generateInstances(prisma, TODAY, TODAY);
    mine = (await instancesFor(a.id))[0].id;
    theirs = (await instancesFor(b.id))[0].id;
  });

  it("keeps a thread in the order it was written", async () => {
    await addComment(prisma, mine, member(), "Started this");
    await addComment(prisma, mine, admin(), "Any blockers?");
    await addComment(prisma, mine, member(), "Supplier is late");

    const thread = await listComments(prisma, mine, member());
    expect(thread.map((c) => c.body)).toEqual([
      "Started this",
      "Any blockers?",
      "Supplier is late",
    ]);
    expect(thread.map((c) => c.author.name)).toEqual(["Alex Member", "Ada Admin", "Alex Member"]);
    expect(thread.map((c) => c.mine)).toEqual([true, false, true]);
  });

  it("refuses to read another member's thread", async () => {
    await addComment(prisma, theirs, other(), "Private to Brad");
    await expect(listComments(prisma, theirs, member())).rejects.toThrow(/not found/i);
  });

  it("refuses to comment on another member's task", async () => {
    await expect(addComment(prisma, theirs, member(), "Butting in")).rejects.toThrow(/not found/i);
    expect(await prisma.comment.count()).toBe(0);
  });

  it("lets an admin read and write on anyone's task", async () => {
    await addComment(prisma, theirs, admin(), "Chasing this");
    const thread = await listComments(prisma, theirs, admin());
    expect(thread).toHaveLength(1);
  });

  it("rejects an empty comment", async () => {
    await expect(addComment(prisma, mine, member(), "   ")).rejects.toThrow(/write something/i);
  });

  it("lets the author delete their own, and refuses someone else's", async () => {
    const c = await addComment(prisma, mine, member(), "Mine to remove");
    await expect(deleteComment(prisma, c.id, other())).rejects.toThrow(/not found/i);

    await deleteComment(prisma, c.id, member());
    expect(await prisma.comment.count()).toBe(0);
  });

  it("lets an admin delete anyone's comment", async () => {
    const c = await addComment(prisma, mine, member(), "Admin will remove this");
    await deleteComment(prisma, c.id, admin());
    expect(await prisma.comment.count()).toBe(0);
  });

  describe("attachments", () => {
    async function attach(commentId: string, actor = member(), overrides = {}) {
      const file = {
        filename: "shelf.jpg",
        contentType: "image/jpeg",
        bytes: 120_000,
        ...overrides,
      };
      const { storageKey } = await startAttachmentUpload(prisma, commentId, actor, file);
      return finishAttachmentUpload(prisma, commentId, actor, { ...file, storageKey });
    }

    it("records a file and shows it on the comment", async () => {
      const c = await addComment(prisma, mine, member(), "Photo of the shelf");
      await attach(c.id);

      const thread = await listComments(prisma, mine, member());
      expect(thread[0].attachments).toHaveLength(1);
      expect(thread[0].attachments[0].filename).toBe("shelf.jpg");
    });

    it("mints a key the client never chose", async () => {
      const c = await addComment(prisma, mine, member(), "x");
      const { storageKey } = await startAttachmentUpload(prisma, c.id, member(), {
        filename: "../../etc/passwd",
        contentType: "image/jpeg",
        bytes: 10,
      });
      expect(storageKey.startsWith(`${fixture.orgId}/`)).toBe(true);
      expect(storageKey).not.toContain("..");
    });

    it("refuses a key pointing outside the organisation", async () => {
      const c = await addComment(prisma, mine, member(), "x");
      await expect(
        finishAttachmentUpload(prisma, c.id, member(), {
          storageKey: "some-other-org/stolen.jpg",
          filename: "stolen.jpg",
          contentType: "image/jpeg",
          bytes: 10,
        }),
      ).rejects.toThrow(/invalid upload/i);
    });

    it("refuses a file type that would execute in our origin", async () => {
      const c = await addComment(prisma, mine, member(), "x");
      await expect(
        attach(c.id, member(), { contentType: "text/html", filename: "x.html" }),
      ).rejects.toThrow(/not accepted/i);
    });

    it("refuses a file over the size cap", async () => {
      const c = await addComment(prisma, mine, member(), "x");
      await expect(attach(c.id, member(), { bytes: 50 * 1024 * 1024 })).rejects.toThrow(/10MB/);
    });

    it("refuses to hand a download link to someone who cannot see the task", async () => {
      const c = await addComment(prisma, mine, member(), "x");
      const a = await attach(c.id);

      await expect(attachmentDownloadUrl(prisma, a.id, other())).rejects.toThrow(/not found/i);
      await expect(attachmentDownloadUrl(prisma, a.id, member())).resolves.toContain("https://");
    });

    it("takes the attachments with the comment", async () => {
      const c = await addComment(prisma, mine, member(), "x");
      await attach(c.id);
      await deleteComment(prisma, c.id, member());
      expect(await prisma.attachment.count()).toBe(0);
    });
  });
});
