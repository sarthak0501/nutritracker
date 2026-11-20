import { createHash } from "node:crypto";
import { type MealType, type Prisma } from "@prisma/client";

export function plateBatchRequestId(actorId: string, occurrenceKey: string, owner: "self" | "buddy") {
  const identity = JSON.stringify([actorId, occurrenceKey]) + ":" + owner;
  return "mcp-buddy:" + createHash("sha256").update(identity).digest("hex");
}
export function selfPlateBatchRequestId(actorId: string, occurrenceKey: string) {
  return plateBatchRequestId(actorId, occurrenceKey, "self");
}

export function entriesOccurrence(entryIds: string[], date: string, mealType: MealType) {
  return "entries:" + createHash("sha256").update(JSON.stringify([[...new Set(entryIds)].sort(), date, mealType])).digest("hex");
}
export function savedOccurrence(occurrenceId: string) { return "saved:" + occurrenceId; }

/** Previous releases stored selected item IDs but no occurrence key. Treat a matching
 * historical share conservatively rather than posting a second copy to the diary. */
export async function findMealOccurrence(tx: Prisma.TransactionClient, senderId: string, recipientId: string,
  occurrenceKey: string, date: string, mealType: MealType, itemIds: string[]) {
  const exact = await tx.mealProposal.findUnique({ where: { senderId_recipientId_occurrenceKey: { senderId, recipientId, occurrenceKey } } });
  if (exact || occurrenceKey.startsWith("recipe:")) return exact;
  const legacy = await tx.mealProposal.findMany({ where: { senderId, recipientId, date, mealType, occurrenceKey: null, status: { in: ["PENDING", "ACCEPTED"] } } });
  const ids = new Set(itemIds);
  return legacy.find(row => Array.isArray(row.items) && row.items.some(item =>
    item && typeof item === "object" && !Array.isArray(item) && typeof item.id === "string" && ids.has(item.id))) ?? null;
}
