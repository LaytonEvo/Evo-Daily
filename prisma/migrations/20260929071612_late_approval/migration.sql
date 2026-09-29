-- AlterTable
ALTER TABLE "TaskInstance" ADD COLUMN     "lateApprovedAt" TIMESTAMP(3),
ADD COLUMN     "lateApprovedById" TEXT;

-- AddForeignKey
ALTER TABLE "TaskInstance" ADD CONSTRAINT "TaskInstance_lateApprovedById_fkey" FOREIGN KEY ("lateApprovedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
