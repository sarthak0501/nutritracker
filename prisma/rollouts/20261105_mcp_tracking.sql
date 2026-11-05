-- Preserve all existing records; unknown workout energy can be stored honestly.
BEGIN;
ALTER TABLE "WorkoutEntry" ALTER COLUMN "caloriesBurned" DROP NOT NULL;
CREATE TABLE "McpMutation" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "inputHash" TEXT NOT NULL,
  "result" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "McpMutation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "McpMutation_userId_requestId_key" ON "McpMutation"("userId", "requestId");
ALTER TABLE "McpMutation" ADD CONSTRAINT "McpMutation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
COMMIT;
