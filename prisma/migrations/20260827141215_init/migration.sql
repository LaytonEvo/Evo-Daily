-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "Frequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'ONE_OFF');

-- CreateEnum
CREATE TYPE "InstanceStatus" AS ENUM ('PENDING', 'COMPLETED', 'MISSED');

-- CreateEnum
CREATE TYPE "AuditSource" AS ENUM ('USER', 'SYSTEM');

-- CreateTable
CREATE TABLE "Organisation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/London',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organisation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'MEMBER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "slackUserId" TEXT,
    "managerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "colour" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskTemplate" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "categoryId" TEXT,
    "assigneeId" TEXT NOT NULL,
    "frequency" "Frequency" NOT NULL,
    "daysOfWeek" INTEGER[],
    "dayOfWeek" INTEGER,
    "dayOfMonth" INTEGER,
    "dueTime" TEXT,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskInstance" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "dueDate" DATE NOT NULL,
    "dueAt" TIMESTAMP(3),
    "title" TEXT NOT NULL,
    "assigneeId" TEXT NOT NULL,
    "categoryId" TEXT,
    "status" "InstanceStatus" NOT NULL DEFAULT 'PENDING',
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "wasLate" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "userId" TEXT,
    "fromStatus" "InstanceStatus" NOT NULL,
    "toStatus" "InstanceStatus" NOT NULL,
    "source" "AuditSource" NOT NULL DEFAULT 'USER',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settings" (
    "organisationId" TEXT NOT NULL,
    "graceDays" INTEGER NOT NULL DEFAULT 2,
    "generationHorizonDays" INTEGER NOT NULL DEFAULT 14,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("organisationId")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_organisationId_isActive_idx" ON "User"("organisationId", "isActive");

-- CreateIndex
CREATE INDEX "Category_organisationId_sortOrder_idx" ON "Category"("organisationId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Category_organisationId_name_key" ON "Category"("organisationId", "name");

-- CreateIndex
CREATE INDEX "TaskTemplate_organisationId_isActive_idx" ON "TaskTemplate"("organisationId", "isActive");

-- CreateIndex
CREATE INDEX "TaskTemplate_assigneeId_idx" ON "TaskTemplate"("assigneeId");

-- CreateIndex
CREATE INDEX "TaskInstance_assigneeId_dueDate_idx" ON "TaskInstance"("assigneeId", "dueDate");

-- CreateIndex
CREATE INDEX "TaskInstance_organisationId_dueDate_status_idx" ON "TaskInstance"("organisationId", "dueDate", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TaskInstance_templateId_dueDate_key" ON "TaskInstance"("templateId", "dueDate");

-- CreateIndex
CREATE INDEX "AuditLog_instanceId_at_idx" ON "AuditLog"("instanceId", "at");

-- CreateIndex
CREATE INDEX "AuditLog_organisationId_at_idx" ON "AuditLog"("organisationId", "at");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskTemplate" ADD CONSTRAINT "TaskTemplate_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskTemplate" ADD CONSTRAINT "TaskTemplate_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskTemplate" ADD CONSTRAINT "TaskTemplate_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskTemplate" ADD CONSTRAINT "TaskTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskInstance" ADD CONSTRAINT "TaskInstance_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskInstance" ADD CONSTRAINT "TaskInstance_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "TaskTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskInstance" ADD CONSTRAINT "TaskInstance_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskInstance" ADD CONSTRAINT "TaskInstance_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskInstance" ADD CONSTRAINT "TaskInstance_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "TaskInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settings" ADD CONSTRAINT "Settings_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
