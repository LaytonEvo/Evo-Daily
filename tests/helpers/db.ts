/**
 * Database-backed test harness.
 *
 * These tests run against a real PostgreSQL database, because the parts they
 * cover — the unique constraint that makes generation idempotent, the sweep,
 * the reporting aggregates — are exactly the parts a mock would not catch.
 *
 * Point TEST_DATABASE_URL at a throwaway database. If it is not set, or the
 * database is unreachable, these suites skip rather than fail, so `npm test`
 * still runs the pure unit tests anywhere.
 */

import { Frequency, PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { toDbDate, type DateOnly } from "@/lib/time";

const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

export const prisma = new PrismaClient({
  datasources: url ? { db: { url } } : undefined,
  log: ["error"],
});

let reachable: boolean | null = null;

export async function databaseAvailable(): Promise<boolean> {
  if (reachable !== null) return reachable;
  if (!url) {
    reachable = false;
    return reachable;
  }
  try {
    await prisma.$queryRaw`SELECT 1`;
    reachable = true;
  } catch {
    reachable = false;
  }
  return reachable;
}

export async function resetDatabase(): Promise<void> {
  await prisma.auditLog.deleteMany();
  await prisma.taskInstance.deleteMany();
  await prisma.taskTemplate.deleteMany();
  await prisma.category.deleteMany();
  await prisma.settings.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organisation.deleteMany();
}

export type Fixture = {
  orgId: string;
  adminId: string;
  memberId: string;
  otherMemberId: string;
  categoryId: string;
};

export async function seedFixture(
  options: { graceDays?: number; generationHorizonDays?: number } = {},
): Promise<Fixture> {
  await resetDatabase();

  const org = await prisma.organisation.create({
    data: { name: "Test Org", timezone: "Europe/London" },
  });

  await prisma.settings.create({
    data: {
      organisationId: org.id,
      graceDays: options.graceDays ?? 2,
      generationHorizonDays: options.generationHorizonDays ?? 14,
    },
  });

  const passwordHash = await bcrypt.hash("TestPassword1!", 4);

  const admin = await prisma.user.create({
    data: {
      organisationId: org.id,
      email: "admin@test.local",
      name: "Ada Admin",
      passwordHash,
      role: Role.ADMIN,
      mustChangePassword: false,
    },
  });

  const member = await prisma.user.create({
    data: {
      organisationId: org.id,
      email: "alex@test.local",
      name: "Alex Member",
      passwordHash,
      role: Role.MEMBER,
      mustChangePassword: false,
    },
  });

  const other = await prisma.user.create({
    data: {
      organisationId: org.id,
      email: "brad@test.local",
      name: "Brad Member",
      passwordHash,
      role: Role.MEMBER,
      mustChangePassword: false,
    },
  });

  const category = await prisma.category.create({
    data: { organisationId: org.id, name: "Ops", colour: "#2563eb", sortOrder: 1 },
  });

  return {
    orgId: org.id,
    adminId: admin.id,
    memberId: member.id,
    otherMemberId: other.id,
    categoryId: category.id,
  };
}

export type TemplateInput = {
  title?: string;
  frequency?: Frequency;
  daysOfWeek?: number[];
  dayOfWeek?: number | null;
  dayOfMonth?: number | null;
  dueTime?: string | null;
  startDate: DateOnly;
  endDate?: DateOnly | null;
  assigneeId?: string;
  categoryId?: string | null;
  isActive?: boolean;
};

export async function createTemplate(fixture: Fixture, input: TemplateInput) {
  return prisma.taskTemplate.create({
    data: {
      organisationId: fixture.orgId,
      title: input.title ?? "Test task",
      frequency: input.frequency ?? Frequency.DAILY,
      daysOfWeek: input.daysOfWeek ?? [1, 2, 3, 4, 5],
      dayOfWeek: input.dayOfWeek ?? null,
      dayOfMonth: input.dayOfMonth ?? null,
      dueTime: input.dueTime ?? null,
      startDate: toDbDate(input.startDate),
      endDate: input.endDate ? toDbDate(input.endDate) : null,
      assigneeId: input.assigneeId ?? fixture.memberId,
      categoryId: input.categoryId === undefined ? fixture.categoryId : input.categoryId,
      isActive: input.isActive ?? true,
      createdById: fixture.adminId,
    },
  });
}

export async function instancesFor(templateId: string) {
  return prisma.taskInstance.findMany({
    where: { templateId },
    orderBy: { dueDate: "asc" },
  });
}
