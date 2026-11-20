import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { scaleStoredMealItem } from "@/lib/meal-library";
import { checkRecipeAllocation, selfPlateBatchRequestId } from "@/lib/meal-occurrence";
import { insertMealSnapshots } from "@/lib/meal-writes";
import { McpMutationError, withMcpMutation } from "@/lib/mcp-mutations";
import { materializeRecipeItems, preparedRecipeTokenSchema, verifyPreparedRecipe } from "@/lib/mcp-recipe";

export const SelfRecipePlateSchema = z.object({
  preparedRecipeToken: preparedRecipeTokenSchema,
  portion: z.object({ amount: z.number().finite().positive().max(1_000_000), unit: z.enum(["grams", "servings"]) }).strict(),
  confirmed: z.literal(true).describe("The person explicitly chose to save only their own eaten portion."),
}).strict();

export async function logSelfRecipePlate(userId: string, input: z.output<typeof SelfRecipePlateSchema>, client: PrismaClient = prisma) {
  // One immutable intent per recipe token, including when the original response
  // was lost and a retry arrives after the signed preview expires.
  const requestId = "self-recipe:" + createHash("sha256").update(input.preparedRecipeToken).digest("hex");
  const receipt = await withMcpMutation(userId, requestId, "log_self_recipe", input, async tx => {
    const recipe = await verifyPreparedRecipe(userId, input.preparedRecipeToken);
    if (input.portion.unit !== recipe.yield.unit || input.portion.amount > recipe.yield.amount) {
      throw new McpMutationError("Use the cooked yield unit and choose a portion within the recipe yield.");
    }
    const occurrence = "recipe:" + recipe.id;
    const key = selfPlateBatchRequestId(userId, occurrence);
    const prior = await tx.logBatch.findUnique({ where: { userId_requestId: { userId, requestId: key } } });
    if (prior) return { date: recipe.date, batchId: prior.id, alreadySaved: true };
    const recipeAllocation = await checkRecipeAllocation(tx, userId, recipe.id, input.portion.amount, recipe.yield.amount);
    const items = await materializeRecipeItems(tx, userId, recipe);
    const batch = await tx.logBatch.create({ data: { requestId: key, userId, kind: `mcp-buddy:${recipe.date}` } });
    await insertMealSnapshots(tx, { userId, batchId: batch.id, date: recipe.date, mealType: recipe.mealType,
      items: items.map(item => scaleStoredMealItem(item, input.portion.amount / recipe.yield.amount)) });
    return { date: recipe.date, batchId: batch.id, recipeAllocation };
  }, client);
  const batch = await client.logBatch.findFirstOrThrow({ where: { id: receipt.batchId, userId },
    select: { createdAt: true, undoneAt: true, _count: { select: { entries: true } } } });
  return { batchId: receipt.batchId, date: receipt.date, ...(receipt.alreadySaved ? { alreadySaved: true } : {}),
    saved: batch.undoneAt === null && batch._count.entries > 0, entryCount: batch._count.entries,
    ...(batch.undoneAt ? { undone: true as const } : {}),
    undoExpiresAt: new Date(batch.createdAt.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    note: "This recipe can add your plate once. Check your daily log for the current portion and any corrections." };
}
