-- CreateTable
CREATE TABLE "DayCheck" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "completed" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DayCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DayCheckReply" (
    "id" TEXT NOT NULL,
    "dayCheckId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DayCheckReply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DayCheckRead" (
    "userId" TEXT NOT NULL,
    "dayCheckId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DayCheckRead_pkey" PRIMARY KEY ("userId","dayCheckId")
);

-- CreateIndex
CREATE INDEX "DayCheck_organisationId_day_idx" ON "DayCheck"("organisationId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "DayCheck_userId_day_key" ON "DayCheck"("userId", "day");

-- CreateIndex
CREATE INDEX "DayCheckReply_dayCheckId_createdAt_idx" ON "DayCheckReply"("dayCheckId", "createdAt");

-- CreateIndex
CREATE INDEX "DayCheckRead_userId_idx" ON "DayCheckRead"("userId");

-- AddForeignKey
ALTER TABLE "DayCheck" ADD CONSTRAINT "DayCheck_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DayCheck" ADD CONSTRAINT "DayCheck_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DayCheckReply" ADD CONSTRAINT "DayCheckReply_dayCheckId_fkey" FOREIGN KEY ("dayCheckId") REFERENCES "DayCheck"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DayCheckReply" ADD CONSTRAINT "DayCheckReply_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DayCheckRead" ADD CONSTRAINT "DayCheckRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DayCheckRead" ADD CONSTRAINT "DayCheckRead_dayCheckId_fkey" FOREIGN KEY ("dayCheckId") REFERENCES "DayCheck"("id") ON DELETE CASCADE ON UPDATE CASCADE;
