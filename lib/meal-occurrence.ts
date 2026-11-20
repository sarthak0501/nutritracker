import { createHash } from "node:crypto";
import { type MealType, type Prisma } from "@prisma/client";

import { McpMutationError } from "@/lib/mcp-mutations";

/** The caller holds the cook's account lock. Original allocations survive edits/undo.
 * Store this object in the new mutation's receipt in the same transaction as its plates. */
export async function checkRecipeAllocation(tx: Prisma.TransactionClient, actorId: string, recipeId: string, amount: number, yieldAmount: number) {
  const [row] = await tx.$queryRaw<Array<{ used: number }>>`
    SELECT COALESCE(SUM((result->'recipeAllocation'->>'amount')::double precision), 0)::double precision AS used
    FROM "McpMutation" WHERE "userId" = ${actorId} AND operation IN ('log_self_recipe', 'log_buddy_meal')
      AND result->'recipeAllocation'->>'recipeId' = ${recipeId}`;
  const total = row.used + amount;
  if (!Number.isFinite(total) || !Number.isFinite(yieldAmount) || amount <= 0 || total > yieldAmount * (1 + 1e-12))
    throw new McpMutationError("These portions and the portions already logged from this recipe exceed its cooked yield. Check the amounts before saving.");
  return { recipeId, amount };
}

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

/** A client can reference a logged plate using all entries or just the chosen items.
 * Historical proposals also retained their selected IDs before occurrence keys existed. */
export async function findMealOccurrence(tx: Prisma.TransactionClient, senderId: string, recipientId: string,
  occurrenceKey: string, date: string, mealType: MealType, itemIds: string[]) {
  const exact = await tx.mealProposal.findUnique({ where: { senderId_recipientId_occurrenceKey: { senderId, recipientId, occurrenceKey } } });
  if (exact || occurrenceKey.startsWith("recipe:")) return exact;
  const alternatives: Prisma.MealProposalWhereInput[] = [{ occurrenceKey: null }];
  if (occurrenceKey.startsWith("entries:")) alternatives.push({ occurrenceKey: { startsWith: "entries:" } });
  const candidates = await tx.mealProposal.findMany({ where: { senderId, recipientId, date, mealType,
    OR: alternatives, status: { in: ["PENDING", "ACCEPTED", "DIRECT"] } } });
  const ids = new Set(itemIds);
  for (const row of candidates) {
    if (!Array.isArray(row.items)) continue;
    const priorIds = row.items.flatMap(item => item && typeof item === "object" && !Array.isArray(item) && typeof item.id === "string" ? [item.id] : []);
    if (!priorIds.some(id => ids.has(id))) continue;
    if (priorIds.length === ids.size && priorIds.every(id => ids.has(id))) return row;
    throw new McpMutationError("Some of these entries were already sent or logged for this buddy and meal. Check the original share and select only the remaining items.");
  }
  return null;
}
