import type { Food, LogEntry } from "@prisma/client";

export type Nutrients = {
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g?: number;
  sodium_mg?: number;
};

/** Round to 1 decimal, strip trailing .0 */
export function round1(n: number): string {
  const v = Math.round(n * 10) / 10;
  return v % 1 === 0 ? String(Math.round(v)) : v.toFixed(1);
}

export function round0(n: number): string {
  return String(Math.round(n));
}

export function addNutrients(a: Nutrients, b: Nutrients): Nutrients {
  return {
    kcal: a.kcal + b.kcal,
    protein_g: a.protein_g + b.protein_g,
    carbs_g: a.carbs_g + b.carbs_g,
    fat_g: a.fat_g + b.fat_g,
    fiber_g: (a.fiber_g ?? 0) + (b.fiber_g ?? 0),
    sodium_mg: (a.sodium_mg ?? 0) + (b.sodium_mg ?? 0)
  };
}

export function nutrientsForGrams(food: Food, grams: number): Nutrients {
  const factor = grams / 100;
  return {
    kcal: food.kcalPer100g * factor,
    protein_g: food.proteinPer100g * factor,
    carbs_g: food.carbsPer100g * factor,
    fat_g: food.fatPer100g * factor,
    fiber_g: food.fiberPer100g == null ? undefined : food.fiberPer100g * factor,
    sodium_mg:
      food.sodiumMgPer100g == null ? undefined : food.sodiumMgPer100g * factor
  };
}

export function gramsForEntry(entry: LogEntry, food: Food): number | null {
  if (entry.unit === "GRAM") return entry.amount;
  if (entry.unit === "SERVING") {
    if (!food.servingGrams) return null;
    return entry.amount * food.servingGrams;
  }
  return null;
}

export function safeNutrientsForEntry(
  entry: LogEntry,
  food: Food
): Nutrients | null {
  // Prefer snapshot nutrients (historical accuracy, immune to food edits)
  if (
    entry.snapshotKcal != null &&
    entry.snapshotProteinG != null &&
    entry.snapshotCarbsG != null &&
    entry.snapshotFatG != null
  ) {
    return {
      kcal: entry.snapshotKcal,
      protein_g: entry.snapshotProteinG,
      carbs_g: entry.snapshotCarbsG,
      fat_g: entry.snapshotFatG,
    };
  }
  // Fall back to computed (existing entries without snapshot)
  const grams = gramsForEntry(entry, food);
  if (grams == null || !Number.isFinite(grams) || grams <= 0) return null;
  return nutrientsForGrams(food, grams);
}

