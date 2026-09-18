-- CreateEnum
CREATE TYPE "SignInOutcome" AS ENUM ('SUCCESS', 'WRONG_PASSWORD', 'DEACTIVATED');

-- CreateTable
CREATE TABLE "SignIn" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" "SignInOutcome" NOT NULL,

    CONSTRAINT "SignIn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SignIn_organisationId_at_idx" ON "SignIn"("organisationId", "at");

-- CreateIndex
CREATE INDEX "SignIn_userId_at_idx" ON "SignIn"("userId", "at");

-- AddForeignKey
ALTER TABLE "SignIn" ADD CONSTRAINT "SignIn_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignIn" ADD CONSTRAINT "SignIn_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
