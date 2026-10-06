import type { AmountUnit, FoodSource, Prisma } from "@prisma/client";

type FoodUnits = { source: FoodSource; nutritionBasis?: string | null; servingGrams?: number | null };
type EntryUnits = { amount: number; unit: AmountUnit; estimationMeta?: Prisma.JsonValue | null };

/** Legacy LLM quantities sometimes meant counts, despite being stored as GRAM. */
export function hasGramNutrition(food: FoodUnits, entry?: EntryUnits): boolean {
  if (food.nutritionBasis === "GRAMS" || food.source !== "LLM") return true;
  const meta = entry?.estimationMeta;
  return !!meta && typeof meta === "object" && !Array.isArray(meta) &&
    typeof meta.originalUnit === "string" && /^(g|gram|grams)$/i.test(meta.originalUnit.trim());
}

export function isLegacyPortion(entry: EntryUnits, food: FoodUnits): boolean {
  return !hasGramNutrition(food, entry);
}

export function entryAmountLabel(entry: EntryUnits, food: FoodUnits): string {
  const meta = entry.estimationMeta;
  if (meta && typeof meta === "object" && !Array.isArray(meta) &&
    typeof meta.repeatPortionLabel === "string" && meta.repeatPortionLabel.length <= 500) {
    return meta.repeatPortionLabel;
  }
  if (isLegacyPortion(entry, food)) return "logged portion";
  const amount = Number(entry.amount.toFixed(2));
  return entry.unit === "GRAM" ? `${amount} g` : `${amount} ${amount === 1 ? "serving" : "servings"}`;
}
