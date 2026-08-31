import { Frequency } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createTemplate,
  databaseAvailable,
  prisma,
  seedFixture,
  type Fixture,
} from "./helpers/db";
import {
  categoryUsage,
  createCategory,
  deleteCategory,
  updateCategory,
} from "@/lib/categories";
import { generateInstances } from "@/lib/recurrence";
import { buildOrgReport, buildWindow } from "@/lib/reports";
import { addDays } from "@/lib/time";

const available = await databaseAvailable();
const describeDb = available ? describe : describe.skip;

const TODAY = "2026-08-27";

describeDb("categories", () => {
  let fixture: Fixture;

  beforeEach(async () => {
    fixture = await seedFixture();
  });

  const add = (name: string, colour = "#2563eb") =>
    createCategory(prisma, fixture.orgId, { name, colour });

  it("creates a category and appends it to the end of the list", async () => {
    // The fixture ships one category at sortOrder 1.
    const first = await add("Stock", "#d97706");
    const second = await add("Marketing", "#7c3aed");

    expect(first.name).toBe("Stock");
    expect(first.isActive).toBe(true);
    expect(second.sortOrder).toBeGreaterThan(first.sortOrder);
  });

  it("refuses a duplicate name within the organisation", async () => {
    await add("Stock");
    await expect(add("Stock")).rejects.toThrow(/already a category called/i);
  });

  it("lets another organisation use the same name", async () => {
    await add("Stock");
    const otherOrg = await prisma.organisation.create({ data: { name: "Elsewhere" } });
    const theirs = await createCategory(prisma, otherOrg.id, {
      name: "Stock",
      colour: "#2563eb",
    });
    expect(theirs.name).toBe("Stock");
  });

  it("renames and recolours", async () => {
    const category = await add("Stock", "#d97706");
    const updated = await updateCategory(prisma, fixture.orgId, category.id, {
      name: "Inventory",
      colour: "#0891b2",
    });
    expect(updated.name).toBe("Inventory");
    expect(updated.colour).toBe("#0891b2");
  });

  it("relabels history when renamed, because instances hold the id not the name", async () => {
    const category = await add("Stock", "#d97706");
    await createTemplate(fixture, {
      title: "Count the range balls",
      startDate: addDays(TODAY, -5),
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
      categoryId: category.id,
    });
    await generateInstances(prisma, addDays(TODAY, -5), TODAY);

    await updateCategory(prisma, fixture.orgId, category.id, { name: "Inventory" });

    const report = await buildOrgReport(prisma, fixture.orgId, buildWindow({ days: 30 }, TODAY));
    const row = report.categories.find((c) => c.categoryId === category.id);
    // A rename is meant to apply everywhere, unlike reassigning a task.
    expect(row?.name).toBe("Inventory");
    expect(row?.assigned).toBe(6);
  });

  it("refuses to rename onto a name already in use", async () => {
    await add("Stock");
    const marketing = await add("Marketing");
    await expect(
      updateCategory(prisma, fixture.orgId, marketing.id, { name: "Stock" }),
    ).rejects.toThrow(/already a category called/i);
  });

  it("retires a category without touching its history", async () => {
    const category = await add("Facilities", "#059669");
    await createTemplate(fixture, {
      title: "Clean the mats",
      startDate: addDays(TODAY, -3),
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
      categoryId: category.id,
    });
    await generateInstances(prisma, addDays(TODAY, -3), TODAY);

    const retired = await updateCategory(prisma, fixture.orgId, category.id, {
      isActive: false,
    });
    expect(retired.isActive).toBe(false);

    // The instances and their category reference survive.
    const report = await buildOrgReport(prisma, fixture.orgId, buildWindow({ days: 30 }, TODAY));
    const row = report.categories.find((c) => c.categoryId === category.id);
    expect(row?.name).toBe("Facilities");
    expect(row?.assigned).toBe(4);
  });

  it("can be brought back after being retired", async () => {
    const category = await add("Seasonal");
    await updateCategory(prisma, fixture.orgId, category.id, { isActive: false });
    const revived = await updateCategory(prisma, fixture.orgId, category.id, {
      isActive: true,
    });
    expect(revived.isActive).toBe(true);
  });

  it("deletes one nothing references — a typo should not be permanent", async () => {
    const typo = await add("Markting");
    const removed = await deleteCategory(prisma, fixture.orgId, typo.id);
    expect(removed.name).toBe("Markting");
    expect(await prisma.category.findUnique({ where: { id: typo.id } })).toBeNull();
  });

  it("refuses to delete one a task uses, and says to retire it instead", async () => {
    const category = await add("Stock");
    await createTemplate(fixture, {
      title: "Stock count",
      startDate: TODAY,
      frequency: Frequency.WEEKLY,
      dayOfWeek: 1,
      categoryId: category.id,
    });

    await expect(deleteCategory(prisma, fixture.orgId, category.id)).rejects.toThrow(
      /Turn it off instead/i,
    );
    expect(await prisma.category.findUnique({ where: { id: category.id } })).not.toBeNull();
  });

  it("refuses to delete one that only history references", async () => {
    const category = await add("Stock");
    const template = await createTemplate(fixture, {
      title: "Stock count",
      startDate: addDays(TODAY, -2),
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
      categoryId: category.id,
    });
    await generateInstances(prisma, addDays(TODAY, -2), TODAY);
    // Re-categorise the template. Its past instances keep the snapshot they
    // were generated with, so only history still points at the old category.
    await prisma.taskTemplate.update({
      where: { id: template.id },
      data: { categoryId: null },
    });

    await expect(deleteCategory(prisma, fixture.orgId, category.id)).rejects.toThrow(
      /recorded instance/i,
    );
  });

  it("reports what is using a category", async () => {
    const category = await add("Stock");
    expect(await categoryUsage(prisma, category.id)).toEqual({ templates: 0, instances: 0 });

    await createTemplate(fixture, {
      title: "Stock count",
      startDate: TODAY,
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
      categoryId: category.id,
    });
    await generateInstances(prisma, TODAY, TODAY);

    expect(await categoryUsage(prisma, category.id)).toEqual({ templates: 1, instances: 1 });
  });

  it("will not touch a category belonging to another organisation", async () => {
    const otherOrg = await prisma.organisation.create({ data: { name: "Elsewhere" } });
    const theirs = await createCategory(prisma, otherOrg.id, {
      name: "Theirs",
      colour: "#2563eb",
    });

    await expect(
      updateCategory(prisma, fixture.orgId, theirs.id, { name: "Mine" }),
    ).rejects.toThrow(/not found/i);
    await expect(deleteCategory(prisma, fixture.orgId, theirs.id)).rejects.toThrow(
      /not found/i,
    );
  });
});
