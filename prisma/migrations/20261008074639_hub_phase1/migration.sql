-- CreateEnum
CREATE TYPE "JobRunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'WARNING', 'FAILED');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'MANAGER';

-- AlterTable
ALTER TABLE "TaskTemplate" ADD COLUMN     "sourceModule" TEXT,
ADD COLUMN     "sourceRef" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "moduleAccess" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "sessionsRevokedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "activity_log" (
    "id" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "job_name" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" "JobRunStatus" NOT NULL DEFAULT 'RUNNING',
    "message" TEXT,
    "details" JSONB,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "activity_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "activity_log_job_name_started_at_idx" ON "activity_log"("job_name", "started_at");

-- CreateIndex
CREATE INDEX "activity_log_module_started_at_idx" ON "activity_log"("module", "started_at");

-- CreateIndex
CREATE INDEX "activity_log_status_started_at_idx" ON "activity_log"("status", "started_at");

-- CreateIndex
CREATE INDEX "TaskTemplate_sourceModule_sourceRef_idx" ON "TaskTemplate"("sourceModule", "sourceRef");
