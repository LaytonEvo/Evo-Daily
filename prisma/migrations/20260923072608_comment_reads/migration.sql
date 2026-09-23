-- CreateTable
CREATE TABLE "CommentRead" (
    "userId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommentRead_pkey" PRIMARY KEY ("userId","instanceId")
);

-- CreateIndex
CREATE INDEX "CommentRead_userId_idx" ON "CommentRead"("userId");

-- AddForeignKey
ALTER TABLE "CommentRead" ADD CONSTRAINT "CommentRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommentRead" ADD CONSTRAINT "CommentRead_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "TaskInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
