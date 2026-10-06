-- Additive rollout for the existing db-push-managed database.
-- Apply once before deploying the matching application commit.
-- A duplicate application fails and rolls back; do not use reset or db push.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "cooperativeCheckInEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Food" ADD COLUMN     "nutritionBasis" TEXT;

-- AlterTable
ALTER TABLE "LogEntry" ADD COLUMN     "batchId" TEXT;

-- CreateTable
CREATE TABLE "LogBatch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undoneAt" TIMESTAMP(3),

    CONSTRAINT "LogBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedMeal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT true,
    "items" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedMeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MealProposal" (
    "id" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "senderRequestId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "mealType" "MealType" NOT NULL,
    "items" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "acceptedBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "MealProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyCheckIn" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekStart" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeeklyCheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LogBatch_userId_createdAt_idx" ON "LogBatch"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LogBatch_userId_requestId_key" ON "LogBatch"("userId", "requestId");

-- CreateIndex
CREATE INDEX "SavedMeal_userId_pinned_idx" ON "SavedMeal"("userId", "pinned");

-- CreateIndex
CREATE INDEX "MealProposal_recipientId_status_idx" ON "MealProposal"("recipientId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MealProposal_senderId_senderRequestId_key" ON "MealProposal"("senderId", "senderRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyCheckIn_userId_weekStart_key" ON "WeeklyCheckIn"("userId", "weekStart");

-- CreateIndex
CREATE INDEX "LogEntry_batchId_idx" ON "LogEntry"("batchId");

-- AddForeignKey
ALTER TABLE "LogEntry" ADD CONSTRAINT "LogEntry_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "LogBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LogBatch" ADD CONSTRAINT "LogBatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedMeal" ADD CONSTRAINT "SavedMeal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealProposal" ADD CONSTRAINT "MealProposal_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MealProposal" ADD CONSTRAINT "MealProposal_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyCheckIn" ADD CONSTRAINT "WeeklyCheckIn_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
