import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { decodeJwt } from "jose";
import { type Food, type LogEntry, type Prisma } from "@prisma/client";
import { prepareRecipe, RecipeInputSchema, verifyPreparedRecipe, materializeRecipeItems } from "../lib/mcp-recipe";
import { commitMcpMeal } from "../lib/mcp-nutrition";
import { entryAmountLabel, hasGramNutrition } from "../lib/meal-units";
import { gramsForEntry } from "../lib/nutrition";
import type { EstimateResponse } from "../lib/llm";

const secret = process.env.AUTH_SECRET;
before(() => { process.env.AUTH_SECRET = "fixture-only-recipe-signing-secret-0123456789"; });
after(() => { if (secret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = secret; });

const context = () => ({ date: "2026-11-19", mealType: "DINNER" as const, mealName: "Dal", now: new Date() });
const base = { yield: { amount: 4, unit: "servings" as const },
  nutrition: { basis: "whole_recipe" as const, nutrients: { kcal: 1200, protein_g: 60, carbs_g: 200, fat_g: 0 } } };
const neverEstimate = async (): Promise<EstimateResponse> => { throw new Error("Known nutrition must not be estimated"); };
const ingredientEstimate = async (): Promise<EstimateResponse> => ({
  items: [
    { description: "Lentils", quantity: 250, unit: "g", nutrients: { kcal: 900, protein_g: 40, carbs_g: 120, fat_g: 8, fiber_g: 8 }, confidence: 0.8, assumptions: ["private cooking detail"] },
    { description: "Rice", quantity: 300, unit: "g", nutrients: { kcal: 300, protein_g: 12, carbs_g: 60, fat_g: 0 }, confidence: 0.7, assumptions: [] },
  ], notes: ["private recipe note"],
});

test("whole label preserves exact values and unknown fiber; only cooked units enter diary snapshots", async () => {
  const preview = await prepareRecipe("cook", base, context(), neverEstimate);
  assert.deepEqual(preview.totals, { ...base.nutrition.nutrients, fiber_g: null });
  assert.deepEqual(preview.estimatedNutrients, []);
  assert.equal(preview.isEstimated, false);
  const verified = await verifyPreparedRecipe("cook", preview.preparedRecipeToken);
  assert.equal(verified.id, preview.id);
  const tx = { food: { create: async ({ data }: { data: Partial<Food> }) => {
    assert.equal(data.nutritionBasis, "SERVINGS");
    assert.equal(hasGramNutrition(data as Food), false);
    assert.equal(gramsForEntry({ amount: 250, unit: "GRAM" } as LogEntry, data as Food), null);
    return { id: "fixture-food" };
  } } } as unknown as Prisma.TransactionClient;
  const [snapshot] = await materializeRecipeItems(tx, "cook", verified);
  assert.equal(snapshot.id, preview.items[0].id);
  assert.equal(snapshot.foodId, "fixture-food");
  assert.equal(snapshot.amount, 4);
  assert.equal(snapshot.snapshotFatG, 0);
  assert.equal(snapshot.snapshotFiberG, null);
  assert.equal(entryAmountLabel(snapshot, { nutritionBasis: "SERVINGS", source: "MANUAL" }), "4 servings");
  await assert.rejects(materializeRecipeItems(tx, "other", verified), /connected account/);
});

test("per-serving known nutrition uses the measured conversion without rounding", async () => {
  const source = { ...base, yield: { unit: "grams" as const, amount: 1000 },
    nutrition: { basis: "per_serving" as const, nutrients: { kcal: 300, protein_g: 15, carbs_g: 20.5, fat_g: 0, fiber_g: 0 } } };
  await assert.rejects(prepareRecipe("cook", source, context(), neverEstimate), /cooked grams/);
  const preview = await prepareRecipe("cook", { ...source, nutrition: { ...source.nutrition, servingGrams: 250 } }, context(), neverEstimate);
  assert.equal(preview.items[0].amount, 1000);
  assert.equal(preview.totals.protein_g, 60);
  assert.equal(preview.totals.carbs_g, 82);
  assert.equal(preview.totals.fiber_g, 0);
  assert.equal(RecipeInputSchema.safeParse({ ...source, yield: { unit: "cups", amount: 4 } }).success, false);
  assert.equal(RecipeInputSchema.safeParse({ nutrition: source.nutrition }).success, false);
});

test("ingredient estimates use whole-batch totals and cooked yield; keep private assumptions out of transferable source", async () => {
  const preview = await prepareRecipe("cook", { yield: { unit: "grams", amount: 1000 }, nutrition: { basis: "ingredients" } }, context(), ingredientEstimate);
  assert.equal(preview.isEstimated, true);
  assert.equal(preview.totals.kcal, 1200);
  assert.equal(preview.totals.fiber_g, null, "one missing ingredient value leaves total fiber unknown");
  assert.equal(preview.items[0].amount, 1000, "raw ingredient weights are not cooked yield");
  assert.match(JSON.stringify(preview.ingredientEstimate), /private recipe note/);
  assert.doesNotMatch(JSON.stringify(decodeJwt(preview.preparedRecipeToken)), /private|assumptions|Rice|Lentils/);
});

test("partially supplied facts are preserved when ingredient estimation is explicitly selected", async () => {
  const partial = { ...base, nutrition: { basis: "per_serving" as const, nutrients: { kcal: 320, fat_g: 0 } } };
  await assert.rejects(prepareRecipe("cook", partial, context(), neverEstimate), /protein_g, carbs_g/);
  const preview = await prepareRecipe("cook", { ...partial, nutrition: { ...partial.nutrition, estimateMissingFromIngredients: true } }, context(), ingredientEstimate);
  assert.deepEqual(preview.totals, { kcal: 1280, protein_g: 52, carbs_g: 180, fat_g: 0, fiber_g: null });
  assert.deepEqual(preview.estimatedNutrients, ["protein_g", "carbs_g"]);
});

test("recipe tokens can be used only by the preparing account and never as a personal meal save", async () => {
  const { preparedRecipeToken } = await prepareRecipe("cook", base, context(), neverEstimate);
  await assert.rejects(commitMcpMeal("cook", { preparedMealToken: preparedRecipeToken }), /invalid/);
  await assert.rejects(verifyPreparedRecipe("another", preparedRecipeToken), /another account/);
  await assert.rejects(verifyPreparedRecipe("cook", "x".repeat(16_385)), /invalid/);
  for (const offset of [-2, 2]) {
    const preview = await prepareRecipe("cook", base, { ...context(), now: new Date(Date.now() + offset * 3600 * 1000) }, neverEstimate);
    await assert.rejects(verifyPreparedRecipe("cook", preview.preparedRecipeToken), /invalid|expired/);
  }
});
