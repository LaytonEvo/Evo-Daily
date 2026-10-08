-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('OK', 'DEGRADED', 'DOWN');

-- CreateTable
CREATE TABLE "approvals" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "item_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "preview_url" TEXT,
    "assignee_id" TEXT,
    "requested_by" TEXT,
    "source_ref" TEXT,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "decided_by" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "edits" JSONB,
    "needs_rework" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMP(3),
    "executed_at" TIMESTAMP(3),
    "execution_status" TEXT,
    "execution_result" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integrations" (
    "name" TEXT NOT NULL,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'OK',
    "last_success_at" TIMESTAMP(3),
    "last_error_at" TIMESTAMP(3),
    "last_error" TEXT,
    "token_expires_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integrations_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" TEXT NOT NULL,
    "open_key" TEXT,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "alert_sent" BOOLEAN NOT NULL DEFAULT false,
    "recovered_alert_sent" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hub_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hub_settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "hub_setting_changes" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "reason" TEXT,
    "user_id" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hub_setting_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_errors" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "message" TEXT NOT NULL,
    "digest" TEXT,
    "path" TEXT,
    "method" TEXT,
    "kind" TEXT,
    "stack" TEXT,

    CONSTRAINT "app_errors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "approvals_status_created_at_idx" ON "approvals"("status", "created_at");

-- CreateIndex
CREATE INDEX "approvals_assignee_id_status_idx" ON "approvals"("assignee_id", "status");

-- CreateIndex
CREATE INDEX "approvals_module_source_ref_idx" ON "approvals"("module", "source_ref");

-- CreateIndex
CREATE UNIQUE INDEX "incidents_open_key_key" ON "incidents"("open_key");

-- CreateIndex
CREATE INDEX "incidents_key_opened_at_idx" ON "incidents"("key", "opened_at");

-- CreateIndex
CREATE INDEX "hub_setting_changes_key_at_idx" ON "hub_setting_changes"("key", "at");

-- CreateIndex
CREATE INDEX "app_errors_at_idx" ON "app_errors"("at");

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
