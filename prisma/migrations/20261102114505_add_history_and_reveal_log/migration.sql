-- CreateEnum
CREATE TYPE "HistoryAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'TYPE_CHANGE');

-- CreateEnum
CREATE TYPE "RevealSource" AS ENUM ('VARIABLE', 'HISTORY');

-- CreateTable
CREATE TABLE "HistoryEntry" (
    "id" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "action" "HistoryAction" NOT NULL,
    "key" TEXT NOT NULL,
    "oldKey" TEXT,
    "oldValue" TEXT,
    "oldIv" TEXT,
    "oldAuthTag" TEXT,
    "newValue" TEXT,
    "newIv" TEXT,
    "newAuthTag" TEXT,
    "oldIsSensitive" BOOLEAN,
    "newIsSensitive" BOOLEAN,
    "changedById" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HistoryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RevealLog" (
    "id" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "source" "RevealSource" NOT NULL,
    "userId" TEXT NOT NULL,
    "revealedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RevealLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HistoryEntry_environmentId_changedAt_idx" ON "HistoryEntry"("environmentId", "changedAt");

-- CreateIndex
CREATE INDEX "HistoryEntry_environmentId_key_idx" ON "HistoryEntry"("environmentId", "key");

-- CreateIndex
CREATE INDEX "HistoryEntry_batchId_idx" ON "HistoryEntry"("batchId");

-- CreateIndex
CREATE INDEX "RevealLog_environmentId_revealedAt_idx" ON "RevealLog"("environmentId", "revealedAt");

-- AddForeignKey
ALTER TABLE "HistoryEntry" ADD CONSTRAINT "HistoryEntry_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoryEntry" ADD CONSTRAINT "HistoryEntry_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevealLog" ADD CONSTRAINT "RevealLog_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "Environment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RevealLog" ADD CONSTRAINT "RevealLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
