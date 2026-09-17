-- CreateTable
CREATE TABLE "AbsenceCover" (
    "id" TEXT NOT NULL,
    "absenceId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "coverUserId" TEXT,
    "categoryId" TEXT,

    CONSTRAINT "AbsenceCover_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AbsenceCover_templateId_idx" ON "AbsenceCover"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "AbsenceCover_absenceId_templateId_key" ON "AbsenceCover"("absenceId", "templateId");

-- AddForeignKey
ALTER TABLE "AbsenceCover" ADD CONSTRAINT "AbsenceCover_absenceId_fkey" FOREIGN KEY ("absenceId") REFERENCES "Absence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbsenceCover" ADD CONSTRAINT "AbsenceCover_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "TaskTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbsenceCover" ADD CONSTRAINT "AbsenceCover_coverUserId_fkey" FOREIGN KEY ("coverUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AbsenceCover" ADD CONSTRAINT "AbsenceCover_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
