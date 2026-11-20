BEGIN;

ALTER TABLE "BuddyRelationship"
  ADD COLUMN "requesterAllowsMealLogging" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "addresseeAllowsMealLogging" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "LogBatch" ADD COLUMN "loggedByUsername" TEXT;
ALTER TABLE "MealProposal" ADD COLUMN "occurrenceKey" TEXT;

CREATE UNIQUE INDEX "MealProposal_senderId_recipientId_occurrenceKey_key"
  ON "MealProposal" ("senderId", "recipientId", "occurrenceKey");

COMMIT;
