import { type MealType, type Prisma } from "@prisma/client";
import { z } from "zod";
import type { EstimateResponse } from "@/lib/llm";
import { insertMealSnapshots, type MealEntrySnapshot } from "@/lib/meal-writes";

const nutrientSchema = z.number().finite().nonnegative();

export async function insertEstimatedItems(tx: Prisma.TransactionClient, input: {
  userId: string; batchId: string; date: string; mealType: MealType; mealName?: string | null;
  sourceText: string; items: EstimateResponse["items"]; detectedFrom?: string;
}): Promise<number> {
  const snapshots: MealEntrySnapshot[] = [];
  for (const item of input.items) {
    const per100 = 100 / item.quantity;
    const food = await tx.food.create({ data: {
      name: item.description, source: "LLM", nutritionBasis: "GRAMS", createdByUserId: input.userId,
      kcalPer100g: nutrientSchema.parse(item.nutrients.kcal * per100),
      proteinPer100g: nutrientSchema.parse(item.nutrients.protein_g * per100),
      carbsPer100g: nutrientSchema.parse(item.nutrients.carbs_g * per100),
      fatPer100g: nutrientSchema.parse(item.nutrients.fat_g * per100),
      fiberPer100g: item.nutrients.fiber_g == null ? undefined : nutrientSchema.parse(item.nutrients.fiber_g * per100),
      sodiumMgPer100g: item.nutrients.sodium_mg == null ? undefined : nutrientSchema.parse(item.nutrients.sodium_mg * per100),
    } });
    snapshots.push({
      foodId: food.id, amount: item.quantity, unit: "GRAM", mealType: input.mealType,
      mealName: input.mealName ?? null, isEstimated: true, sourceText: input.sourceText,
      estimationMeta: {
        confidence: item.confidence, assumptions: item.assumptions, originalQuantity: item.quantity,
        originalUnit: item.unit, ...(input.detectedFrom ? { detectedFrom: input.detectedFrom } : {}),
      },
      snapshotKcal: item.nutrients.kcal, snapshotProteinG: item.nutrients.protein_g,
      snapshotCarbsG: item.nutrients.carbs_g, snapshotFatG: item.nutrients.fat_g,
      snapshotFiberG: item.nutrients.fiber_g ?? null,
    });
  }
  return insertMealSnapshots(tx, { userId: input.userId, batchId: input.batchId, date: input.date, items: snapshots });
}

