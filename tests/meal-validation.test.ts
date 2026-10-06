import test from "node:test";
import assert from "node:assert/strict";
import type { Food, LogEntry } from "@prisma/client";
import { parseNutritionEstimate } from "../lib/llm";
import { parseDayEstimate } from "../lib/day-estimate";
import { entryAmountLabel, hasGramNutrition, isLegacyPortion } from "../lib/meal-units";
import { mealDateSchema, snapshotMealEntry, validateRequestId } from "../lib/meal-writes";
import { safeNutrientsForEntry } from "../lib/nutrition";

const item = () => ({
  description: "Two eggs", quantity: 100, unit: "g", assumptions: ["Two large eggs weigh approximately 100 g"],
  nutrients: { kcal: 144, protein_g: 12, carbs_g: 0, fat_g: 10, fiber_g: 0 }, confidence: 0.8,
});
const estimate = (value: unknown) => parseNutritionEstimate({ items: [value], notes: [] });

test("estimates normalize grams and preserve valid zero nutrients", () => {
  for (const unit of ["g", " G ", "gram", "Grams"]) {
    const parsed = estimate({ ...item(), unit });
    assert.equal(parsed.items[0].unit, "g");
    assert.equal(parsed.items[0].nutrients.carbs_g, 0);
    assert.equal(parsed.items[0].nutrients.fiber_g, 0);
  }
  assert.equal(estimate({ ...item(), quantity: "150 g" }).items[0].quantity, 150);
  assert.equal(estimate({ ...item(), quantity: "1 1/2" }).items[0].quantity, 1.5);
});

test("count units and non-finite, negative, or zero weights cannot become gram records", () => {
  for (const unit of ["eggs", "serving", "cup", "kg", ""]) assert.throws(() => estimate({ ...item(), unit }));
  for (const quantity of [0, -1, "-1", "−1", Infinity, NaN]) assert.throws(() => estimate({ ...item(), quantity }));
  for (const value of [-1, "-1 g", Infinity, NaN]) {
    assert.throws(() => estimate({ ...item(), nutrients: { ...item().nutrients, carbs_g: value } }));
  }
});

test("single and whole-day requests are nonempty and bounded across all meals", () => {
  assert.throws(() => parseNutritionEstimate({ items: [], notes: [] }));
  assert.throws(() => parseNutritionEstimate({ items: Array.from({ length: 101 }, item), notes: [] }));
  const meal = (count: number) => ({ mealType: "LUNCH", items: Array.from({ length: count }, item) });
  assert.equal(parseDayEstimate({ meals: [meal(50), meal(50)] }).meals.length, 2);
  assert.throws(() => parseDayEstimate({ meals: [meal(51), meal(50)] }));
  assert.throws(() => parseDayEstimate({ meals: [meal(0)] }));
  assert.throws(() => parseDayEstimate({ meals: [] }));
});

function legacyEntry(): LogEntry & { food: Food } {
  const now = new Date("2026-10-06T00:00:00Z");
  return {
    id: "fixture-entry", userId: "fixture-user", foodId: "fixture-food", date: "2026-10-05", mealType: "BREAKFAST",
    mealName: null, amount: 2, unit: "GRAM", sourceText: "two eggs", isEstimated: true, batchId: null,
    estimationMeta: { originalUnit: "eggs", originalQuantity: 2 },
    snapshotKcal: 144, snapshotProteinG: 12, snapshotCarbsG: 0, snapshotFatG: 10, snapshotFiberG: 0,
    createdAt: now, updatedAt: now,
    food: {
      id: "fixture-food", name: "Two eggs", brand: null, source: "LLM", createdByUserId: "fixture-user",
      barcode: null, offUrl: null, offLastFetchedAt: null, kcalPer100g: 9999, proteinPer100g: 9999,
      carbsPer100g: 9999, fatPer100g: 9999, fiberPer100g: null, sodiumMgPer100g: null,
      servingName: null, servingGrams: null, nutritionBasis: null, createdAt: now, updatedAt: now,
    },
  };
}

test("legacy estimates retain their exact snapshots and cannot claim grams", () => {
  const entry = legacyEntry();
  const before = structuredClone(entry);
  assert.equal(isLegacyPortion(entry, entry.food), true);
  assert.equal(entryAmountLabel(entry, entry.food), "logged portion");
  const copy = snapshotMealEntry(entry, 0.5);
  assert.equal(copy.snapshotKcal, 72);
  assert.equal(copy.snapshotCarbsG, 0);
  assert.equal(copy.snapshotFiberG, 0);
  assert.equal(copy.amount, 1);
  assert.equal(copy.sourceText, entry.sourceText);
  assert.equal(entryAmountLabel(copy, entry.food), "0.5 × (logged portion)");
  assert.deepEqual(entry, before);
  assert.equal(safeNutrientsForEntry(entry, entry.food)?.kcal, 144);
});

test("verified grams and legacy gram metadata are distinguished from unknown counts", () => {
  const entry = legacyEntry();
  assert.equal(hasGramNutrition(entry.food), false);
  entry.food.nutritionBasis = "GRAMS";
  assert.equal(entryAmountLabel(entry, entry.food), "2 g");
  entry.food.nutritionBasis = null;
  entry.estimationMeta = { originalUnit: " Grams " };
  assert.equal(hasGramNutrition(entry.food, entry), true);
  entry.food.source = "MANUAL";
  assert.equal(hasGramNutrition(entry.food), true);
});

test("validation rejects invalid calendar dates, oversized request keys and invalid snapshots", () => {
  assert.equal(mealDateSchema.parse("2024-02-29"), "2024-02-29");
  assert.throws(() => mealDateSchema.parse("2026-02-29"));
  assert.throws(() => mealDateSchema.parse("2026-02-30"));
  assert.throws(() => validateRequestId(" "));
  assert.throws(() => validateRequestId("a".repeat(129)));
  assert.equal(validateRequestId("retry-key"), "retry-key");
  const entry = legacyEntry();
  entry.snapshotKcal = Infinity;
  assert.equal(safeNutrientsForEntry(entry, entry.food), null);
  assert.throws(() => snapshotMealEntry(entry));
});
