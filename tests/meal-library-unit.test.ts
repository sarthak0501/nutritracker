import test from "node:test";
import assert from "node:assert/strict";
import type { Food, LogEntry } from "@prisma/client";
import { itemForSharing, publicMealItem, selectMealItems, storedItemFromEntry, weekStartForDate } from "../lib/meal-library";

function legacyRoti(): LogEntry & { food: Food } {
  return {
    id: "roti-entry", userId: "alice", foodId: "roti-food", date: "2026-10-05", mealType: "DINNER", mealName: null,
    amount: 2, unit: "GRAM", sourceText: "2 roti", isEstimated: true, batchId: null,
    estimationMeta: { originalQuantity: 2, originalUnit: "roti", confidence: 0.8 },
    snapshotKcal: 156, snapshotProteinG: 0, snapshotCarbsG: 30, snapshotFatG: 3, snapshotFiberG: 0,
    createdAt: new Date(), updatedAt: new Date(),
    food: {
      id: "roti-food", name: "Roti", brand: null, source: "LLM", createdByUserId: "alice",
      barcode: null, offUrl: null, offLastFetchedAt: null, kcalPer100g: 7800, proteinPer100g: 999,
      carbsPer100g: 1500, fatPer100g: 150, fiberPer100g: 0, sodiumMgPer100g: null,
      servingName: null, servingGrams: null, nutritionBasis: null, createdAt: new Date(), updatedAt: new Date(),
    },
  };
}

test("repeat portions preserve legacy snapshots and never reinterpret roti count as grams", () => {
  const entry = legacyRoti();
  const original = structuredClone(entry);
  const saved = storedItemFromEntry(entry);
  const repeated = selectMealItems([saved], { multiplier: 0.5 });
  assert.equal(repeated[0].snapshotKcal, 78);
  assert.equal(repeated[0].snapshotProteinG, 0);
  assert.equal(repeated[0].snapshotFiberG, 0);
  assert.equal(publicMealItem(repeated[0]).portionLabel, "0.5 × (logged portion)");
  assert.doesNotMatch(publicMealItem(repeated[0]).portionLabel, /\bg\b/);
  assert.deepEqual(entry, original);
  assert.equal(saved.snapshotKcal, 156);
  assert.equal(selectMealItems([saved], { multiplier: 0.25 })[0].portionLabel, "0.25 × (logged portion)");
});

test("selected items are a strict subset of the server's meal", () => {
  const first = storedItemFromEntry(legacyRoti());
  const second = { ...first, id: "second", name: "Second", snapshotKcal: 50 };
  const chosen = selectMealItems([first, second], { selectedItemIds: ["second"], multiplier: 2 });
  assert.equal(chosen.length, 1);
  assert.equal(chosen[0].snapshotKcal, 100);
  assert.throws(() => selectMealItems([first], { selectedItemIds: ["someone-elses-entry"] }), /no longer available/);
  assert.throws(() => selectMealItems([first], { selectedItemIds: [] }));
  for (const invalid of [0, -1, 0.1, 5, Infinity, NaN]) {
    assert.throws(() => selectMealItems([first], { multiplier: invalid }));
  }
});

test("new gram entries expose weighed portions and preserve a previous repeat label", () => {
  const entry = legacyRoti();
  entry.amount = 80;
  entry.food.nutritionBasis = "GRAMS";
  entry.estimationMeta = { originalQuantity: 80, originalUnit: "g" };
  assert.equal(storedItemFromEntry(entry).portionLabel, "80 g");
  entry.food.nutritionBasis = null;
  entry.estimationMeta = { originalQuantity: 2, originalUnit: "roti", repeatPortionLabel: "0.5 × (2 roti)" };
  assert.equal(storedItemFromEntry(entry).portionLabel, "0.5 × (2 roti)");
});

test("sharing selected food does not expose unrelated full-day text or private metadata", () => {
  const original = storedItemFromEntry(legacyRoti());
  original.sourceText = "Breakfast and lunch details that were not selected";
  original.estimationMeta = { originalUnit: "roti", originalQuantity: 2, privateNote: "not shared" };
  const shared = itemForSharing(original);
  assert.equal(shared.sourceText, null);
  assert.deepEqual(shared.estimationMeta, { originalUnit: "roti", originalQuantity: 2, repeatPortionLabel: original.portionLabel, sharedMeal: true });
  assert.equal(shared.snapshotKcal, original.snapshotKcal);
  assert.equal(original.sourceText, "Breakfast and lunch details that were not selected");
});

test("weekly check-in uses calendar Mondays across month/year boundaries", () => {
  assert.equal(weekStartForDate("2026-10-05"), "2026-10-05");
  assert.equal(weekStartForDate("2026-10-11"), "2026-10-05");
  assert.equal(weekStartForDate("2027-01-01"), "2026-12-28");
  assert.throws(() => weekStartForDate("2026-02-30"));
  assert.throws(() => weekStartForDate("not-a-date"));
});
