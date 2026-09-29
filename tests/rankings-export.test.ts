/**
 * The rankings CSV, through the real route handler.
 *
 * The unit tests cover the ranking itself. What they cannot cover is the thing
 * an export gets wrong: quietly answering a different question to the screen
 * it was downloaded from. The route builds its own report from query
 * parameters, so the window and both filters have to survive the trip — and
 * nothing but driving the handler proves they do.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { Frequency, InstanceStatus, Role } from "@prisma/client";
import { databaseAvailable, prisma, seedFixture, type Fixture } from "./helpers/db";
import { addDays, toDbDate, todayInLondon } from "@/lib/time";

const session = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/lib/auth", () => ({ auth: async () => session.value }));
vi.mock("@/lib/db", async () => ({ prisma: (await import("./helpers/db")).prisma }));

const { GET } = await import("@/app/api/admin/reports/export/route");

const available = await databaseAvailable();
const describeDb = available ? describe : describe.skip;

describeDb("the rankings export", () => {
  let fixture: Fixture;
  const today = todayInLondon();

  beforeEach(async () => {
    fixture = await seedFixture();
    session.value = { user: { id: fixture.adminId } };
  });

  async function task(title: string, outcomes: InstanceStatus[], assigneeId?: string) {
    const template = await prisma.taskTemplate.create({
      data: {
        organisationId: fixture.orgId,
        title,
        frequency: Frequency.DAILY,
        daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
        startDate: toDbDate(addDays(today, -outcomes.length)),
        assigneeId: assigneeId ?? fixture.memberId,
        createdById: fixture.adminId,
      },
    });
    for (const [index, status] of outcomes.entries()) {
      await prisma.taskInstance.create({
        data: {
          organisationId: fixture.orgId,
          templateId: template.id,
          dueDate: toDbDate(addDays(today, -(index + 1))),
          title,
          assigneeId: assigneeId ?? fixture.memberId,
          status,
        },
      });
    }
    return template.id;
  }

  /** The CSV as rows of cells, header included. */
  async function csv(params: string): Promise<string[][]> {
    const response = await GET(
      new Request(`http://localhost/api/admin/reports/export?panel=rankings&${params}`),
    );
    expect(response.status).toBe(200);
    // The file is CRLF, as a CSV for Excel should be.
    return (await response.text())
      .trim()
      .split(/\r?\n/)
      .map((line) => line.split(",").map((cell) => cell.replace(/^"|"$/g, "")));
  }

  const DONE = InstanceStatus.COMPLETED;
  const GONE = InstanceStatus.MISSED;

  it("carries both sides in one table, labelled and ranked", async () => {
    await task("Dropped often", [GONE, GONE, GONE]);
    await task("Always done", [DONE, DONE]);

    const [header, ...rows] = await csv("days=30");
    expect(header).toEqual([
      "side",
      "rank",
      "task",
      "owner",
      "category",
      "count",
      "due",
      "share",
      "active",
    ]);

    const missed = rows.filter((r) => r[0] === "missed");
    expect(missed[0][1]).toBe("1");
    expect(missed[0][2]).toBe("Dropped often");
    expect(missed[0][5]).toBe("3");
    expect(rows.some((r) => r[0] === "completed" && r[2] === "Always done")).toBe(true);
  });

  /**
   * The screen shows a deliberate top ten and says so. A CSV cut to the same
   * ten would be a spreadsheet that cannot answer the question somebody opened
   * a spreadsheet to ask.
   */
  it("exports every task, not the screen's top ten", async () => {
    for (let i = 0; i < 14; i++) {
      await task(`Task ${String(i).padStart(2, "0")}`, [GONE]);
    }

    const rows = (await csv("days=30")).slice(1);
    expect(rows.filter((r) => r[0] === "missed")).toHaveLength(14);
  });

  it("keeps to the window it was asked for", async () => {
    const oldId = await task("Ancient", [GONE]);
    await prisma.taskInstance.updateMany({
      where: { templateId: oldId },
      data: { dueDate: toDbDate(addDays(today, -200)) },
    });
    await task("Recent", [GONE]);

    const rows = (await csv("days=30")).slice(1);
    expect(rows.map((r) => r[2])).toContain("Recent");
    expect(rows.map((r) => r[2])).not.toContain("Ancient");
  });

  it("carries the person filter, so the file matches the screen it came from", async () => {
    await task("Mine", [GONE]);
    await task("Theirs", [GONE, GONE], fixture.otherMemberId);

    const rows = (await csv(`days=30&rankBy=${fixture.memberId}`)).slice(1);
    expect(rows.map((r) => r[2])).toEqual(["Mine"]);
  });

  it("carries the category filter too", async () => {
    const stock = await prisma.category.create({
      data: { organisationId: fixture.orgId, name: "Stock", colour: "#F59E0B", sortOrder: 2 },
    });
    const inStock = await task("In stock", [GONE]);
    await prisma.taskInstance.updateMany({
      where: { templateId: inStock },
      data: { categoryId: stock.id },
    });
    await task("Elsewhere", [GONE, GONE]);

    const rows = (await csv(`days=30&rankCat=${stock.id}`)).slice(1);
    expect(rows.map((r) => r[2])).toEqual(["In stock"]);
  });

  /**
   * The only panel whose export can be narrowed, so the only one where two
   * genuinely different files would otherwise land in Downloads under one name.
   */
  it("names a narrowed file after the person it is about", async () => {
    await task("Mine", [GONE]);
    const response = await GET(
      new Request(
        `http://localhost/api/admin/reports/export?panel=rankings&days=30&rankBy=${fixture.memberId}`,
      ),
    );
    const person = await prisma.user.findUniqueOrThrow({ where: { id: fixture.memberId } });
    const expected = person.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    expect(response.headers.get("content-disposition")).toContain(expected);
  });

  it("is not something a member can download", async () => {
    const member = await prisma.user.findUniqueOrThrow({ where: { id: fixture.memberId } });
    expect(member.role).toBe(Role.MEMBER);
    session.value = { user: { id: fixture.memberId } };

    const response = await GET(
      new Request("http://localhost/api/admin/reports/export?panel=rankings&days=30"),
    );
    expect(response.status).toBe(403);
  });
});
