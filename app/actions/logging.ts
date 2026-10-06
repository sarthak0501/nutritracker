"use server";

import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { MealType, AmountUnit, Prisma } from "@prisma/client";
import { requireSession } from "@/lib/session";
import { assertExpectedUser } from "@/lib/expected-user";
import { parseNutritionEstimate, type EstimateResponse } from "@/lib/llm";
import { parseDayEstimate } from "@/lib/day-estimate";
import { hasGramNutrition, isLegacyPortion } from "@/lib/meal-units";
import {
  withMealBatch, insertMealSnapshots, snapshotMealEntry, undoMealBatch,
  mealDateSchema, portionMultiplierSchema, type LogResult, type MealEntrySnapshot,
} from "@/lib/meal-writes";

function parseNumber(v: FormDataEntryValue | null): number | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function parseString(v: FormDataEntryValue | null): string | null {
  if (typeof v !== "string") return null;
  return v.trim() || null;
}
function requestFromForm(formData: FormData): string | undefined {
  const value = formData.get("requestId");
  if (value === null) return undefined;
  if (typeof value !== "string") throw new Error("Invalid save request.");
  return value;
}
function refreshLogs() {
  revalidatePath("/");
  revalidatePath("/history");
  revalidatePath("/buddy");
}
const nutrientSchema = z.number().finite().nonnegative();
const entrySchema = z.object({
  date: mealDateSchema, mealType: z.nativeEnum(MealType),
  mealName: z.string().trim().max(200).optional(),
  amount: z.number().finite().positive(), unit: z.nativeEnum(AmountUnit),
});
function parseEntryForm(formData: FormData) {
  return entrySchema.parse({
    date: parseString(formData.get("date")), mealType: parseString(formData.get("mealType")),
    mealName: parseString(formData.get("mealName")) ?? undefined,
    amount: parseNumber(formData.get("amount")), unit: parseString(formData.get("unit")),
  });
}
function optionalNutrient(formData: FormData, key: string): number | undefined {
  const value = formData.get(key);
  if (value === null || value === "") return undefined;
  return nutrientSchema.parse(parseNumber(value));
}

export async function createManualFoodAndLogEntry(formData: FormData): Promise<LogResult> {
  const user = await requireSession();
  assertExpectedUser(user.id, formData.get("expectedUserId"));
  const input = parseEntryForm(formData);
  if (input.unit !== "GRAM") throw new Error("Enter the manual food amount in grams.");
  const name = z.string().min(1).max(200).parse(parseString(formData.get("name")));
  const nutrition = {
    kcalPer100g: nutrientSchema.parse(parseNumber(formData.get("kcalPer100g"))),
    proteinPer100g: nutrientSchema.parse(parseNumber(formData.get("proteinPer100g"))),
    carbsPer100g: nutrientSchema.parse(parseNumber(formData.get("carbsPer100g"))),
    fatPer100g: nutrientSchema.parse(parseNumber(formData.get("fatPer100g"))),
    fiberPer100g: optionalNutrient(formData, "fiberPer100g"),
    sodiumMgPer100g: optionalNutrient(formData, "sodiumMgPer100g"),
  };
  const result = await withMealBatch({ userId: user.id, requestId: requestFromForm(formData), kind: "manual" }, async (tx, batchId) => {
    const food = await tx.food.create({ data: {
      name, brand: parseString(formData.get("brand")), source: "MANUAL", nutritionBasis: "GRAMS",
      createdByUserId: user.id, ...nutrition,
    } });
    const factor = input.amount / 100;
    return insertMealSnapshots(tx, { userId: user.id, batchId, date: input.date, items: [{
      foodId: food.id, amount: input.amount, unit: input.unit, mealType: input.mealType,
      mealName: input.mealName ?? null, isEstimated: false, sourceText: null, estimationMeta: null,
      snapshotKcal: nutrition.kcalPer100g * factor, snapshotProteinG: nutrition.proteinPer100g * factor,
      snapshotCarbsG: nutrition.carbsPer100g * factor, snapshotFatG: nutrition.fatPer100g * factor,
      snapshotFiberG: nutrition.fiberPer100g == null ? null : nutrition.fiberPer100g * factor,
    }] });
  });
  refreshLogs();
  return result;
}

async function reusableFoodSnapshot(tx: Prisma.TransactionClient, userId: string, input: {
  foodId: string; amount: number; unit: AmountUnit; mealType: MealType; mealName?: string;
  sourceEntryId?: string; portionMultiplier?: number;
}): Promise<MealEntrySnapshot> {
  const entry = await tx.logEntry.findFirst({
    where: { userId, foodId: input.foodId, ...(input.sourceEntryId ? { id: input.sourceEntryId } : {}) },
    include: { food: true }, orderBy: { createdAt: "desc" },
  });
  if (input.sourceEntryId && !entry) throw new Error("The original food entry is no longer available.");
  if (entry) {
    if (input.unit !== entry.unit) throw new Error("Keep the original portion unit when reusing this food.");
    if (isLegacyPortion(entry, entry.food) && input.portionMultiplier === undefined && input.amount !== entry.amount) {
      throw new Error("Choose a portion multiplier for this older estimate.");
    }
    const multiplier = portionMultiplierSchema.parse(input.portionMultiplier ?? input.amount / entry.amount);
    return { ...snapshotMealEntry(entry, multiplier), mealType: input.mealType, mealName: input.mealName ?? entry.mealName };
  }
  const food = await tx.food.findFirst({ where: { id: input.foodId, createdByUserId: userId } });
  if (!food || !hasGramNutrition(food)) throw new Error("Choose a food from your own logged meals.");
  const grams = input.unit === "GRAM" ? input.amount : food.servingGrams ? input.amount * food.servingGrams : null;
  if (grams === null) throw new Error("This food has no serving weight. Enter grams instead.");
  const factor = grams / 100;
  return {
    foodId: food.id, amount: input.amount, unit: input.unit, mealType: input.mealType,
    mealName: input.mealName ?? null, isEstimated: food.source === "LLM", sourceText: null, estimationMeta: null,
    snapshotKcal: food.kcalPer100g * factor, snapshotProteinG: food.proteinPer100g * factor,
    snapshotCarbsG: food.carbsPer100g * factor, snapshotFatG: food.fatPer100g * factor,
    snapshotFiberG: food.fiberPer100g == null ? null : food.fiberPer100g * factor,
  };
}

export async function createLogEntryFromExistingFood(formData: FormData): Promise<LogResult> {
  const user = await requireSession();
  assertExpectedUser(user.id, formData.get("expectedUserId"));
  const input = parseEntryForm(formData);
  const foodId = z.string().min(1).parse(parseString(formData.get("foodId")));
  const multiplierValue = formData.get("portionMultiplier");
  const portionMultiplier = multiplierValue == null ? undefined : portionMultiplierSchema.parse(parseNumber(multiplierValue));
  const result = await withMealBatch({ userId: user.id, requestId: requestFromForm(formData), kind: "existing-food" }, async (tx, batchId) => {
    const item = await reusableFoodSnapshot(tx, user.id, {
      ...input, foodId, portionMultiplier, sourceEntryId: parseString(formData.get("sourceEntryId")) ?? undefined,
    });
    return insertMealSnapshots(tx, { userId: user.id, batchId, date: input.date, items: [item] });
  });
  refreshLogs();
  return result;
}

export async function updateLogEntry(formData: FormData) {
  const user = await requireSession();
  assertExpectedUser(user.id, formData.get("expectedUserId"));
  const id = z.string().min(1).parse(parseString(formData.get("id")));
  const mealType = z.nativeEnum(MealType).parse(parseString(formData.get("mealType")));
  await prisma.$transaction(async (tx) => {
    const entry = await tx.logEntry.findFirst({ where: { id, userId: user.id }, include: { food: true } });
    if (!entry) throw new Error("Entry not found.");
    // Absolute amount makes an uncertain-response retry safe. Older portion UIs send
    // original amount × chosen multiplier, keeping both amount and snapshots aligned.
    const amount = z.number().finite().positive().parse(parseNumber(formData.get("amount")));
    const snapshot = snapshotMealEntry(entry, portionMultiplierSchema.parse(amount / entry.amount));
    await tx.logEntry.update({ where: { id, userId: user.id }, data: {
      amount, mealType, snapshotKcal: snapshot.snapshotKcal, snapshotProteinG: snapshot.snapshotProteinG,
      snapshotCarbsG: snapshot.snapshotCarbsG, snapshotFatG: snapshot.snapshotFatG, snapshotFiberG: snapshot.snapshotFiberG,
      estimationMeta: snapshot.estimationMeta === null ? Prisma.DbNull : snapshot.estimationMeta as Prisma.InputJsonValue,
    } });
  });
  refreshLogs();
}

export async function deleteLogEntry(formData: FormData) {
  const user = await requireSession();
  assertExpectedUser(user.id, formData.get("expectedUserId"));
  const id = z.string().min(1).parse(parseString(formData.get("id")));
  await prisma.logEntry.deleteMany({ where: { id, userId: user.id } });
  refreshLogs();
}

async function insertEstimatedItems(tx: Prisma.TransactionClient, input: {
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

export async function applyEstimatedMeal(input: {
  date: string; mealType: string; mealName?: string; estimate: EstimateResponse; sourceText: string; requestId?: string; expectedUserId?: string;
}): Promise<LogResult> {
  const user = await requireSession();
  assertExpectedUser(user.id, input.expectedUserId);
  const date = mealDateSchema.parse(input.date);
  const mealType = z.nativeEnum(MealType).parse(input.mealType);
  const mealName = z.string().max(200).optional().parse(input.mealName);
  const sourceText = z.string().max(20000).parse(input.sourceText);
  const estimate = parseNutritionEstimate(input.estimate);
  const result = await withMealBatch({ userId: user.id, requestId: input.requestId, kind: "estimated-meal" }, (tx, batchId) =>
    insertEstimatedItems(tx, { userId: user.id, batchId, date, mealType, mealName, sourceText, items: estimate.items }));
  refreshLogs();
  return result;
}

export async function applyEstimatedDay(input: {
  date: string; meals: Array<{
    mealType: string; mealName?: string | null; detectedFrom?: string;
    items: Array<{ description: string; quantity: number; unit: string; nutrients: {
      kcal: number; protein_g: number; carbs_g: number; fat_g: number; fiber_g?: number;
    }; confidence: number; assumptions: string[] }>;
  }>; sourceText: string; requestId?: string; expectedUserId?: string;
}): Promise<LogResult> {
  const user = await requireSession();
  assertExpectedUser(user.id, input.expectedUserId);
  const date = mealDateSchema.parse(input.date);
  const sourceText = z.string().max(20000).parse(input.sourceText);
  const estimate = parseDayEstimate({ meals: input.meals, unparsed: [], notes: "" });
  for (const meal of estimate.meals) z.string().max(200).nullish().parse(meal.mealName);
  const result = await withMealBatch({ userId: user.id, requestId: input.requestId, kind: "estimated-day" }, async (tx, batchId) => {
    let count = 0;
    for (const meal of estimate.meals) count += await insertEstimatedItems(tx, {
      userId: user.id, batchId, date, mealType: meal.mealType, mealName: meal.mealName,
      sourceText, items: meal.items, detectedFrom: meal.detectedFrom,
    });
    return count;
  });
  refreshLogs();
  return result;
}

export async function copyMealFromDate(input: {
  fromDate: string; toDate: string; mealType: string; requestId?: string; expectedUserId?: string;
}): Promise<LogResult> {
  const user = await requireSession();
  assertExpectedUser(user.id, input.expectedUserId);
  const fromDate = mealDateSchema.parse(input.fromDate);
  const toDate = mealDateSchema.parse(input.toDate);
  const mealType = z.nativeEnum(MealType).parse(input.mealType);
  const result = await withMealBatch({ userId: user.id, requestId: input.requestId, kind: "copy-meal" }, async (tx, batchId) => {
    const entries = await tx.logEntry.findMany({ where: { userId: user.id, date: fromDate, mealType }, include: { food: true } });
    if (!entries.length) throw new Error("There are no foods in that meal to copy.");
    return insertMealSnapshots(tx, { userId: user.id, batchId, date: toDate, items: entries.map((entry) => snapshotMealEntry(entry)) });
  });
  refreshLogs();
  return result;
}

export async function quickLogFood(input: {
  date: string; foodId: string; amount: number; unit: string; mealType: string;
  sourceEntryId?: string; portionMultiplier?: number; requestId?: string; expectedUserId?: string;
}): Promise<LogResult> {
  const user = await requireSession();
  assertExpectedUser(user.id, input.expectedUserId);
  const parsed = entrySchema.parse(input);
  const foodId = z.string().min(1).parse(input.foodId);
  if (input.portionMultiplier !== undefined) portionMultiplierSchema.parse(input.portionMultiplier);
  const result = await withMealBatch({ userId: user.id, requestId: input.requestId, kind: "quick-food" }, async (tx, batchId) => {
    const item = await reusableFoodSnapshot(tx, user.id, { ...parsed, foodId, sourceEntryId: input.sourceEntryId, portionMultiplier: input.portionMultiplier });
    return insertMealSnapshots(tx, { userId: user.id, batchId, date: parsed.date, items: [item] });
  });
  refreshLogs();
  return result;
}

export async function undoLogBatch(input: { batchId: string; expectedUserId?: string }) {
  const user = await requireSession();
  assertExpectedUser(user.id, input.expectedUserId);
  const result = await undoMealBatch(user.id, input.batchId);
  refreshLogs();
  return result;
}

// Old clients must never bypass the recipient's review and consent.
export async function copyMealsToBuddy(_input: { date: string; mealType?: string }): Promise<never> {
  await requireSession();
  throw new Error("Share a meal proposal instead. Your buddy must review and accept it before it is logged.");
}
export async function applyEstimatedMealForBuddy(_input: {
  date: string; mealType: string; mealName?: string; estimate: EstimateResponse; sourceText: string;
}): Promise<never> {
  await requireSession();
  throw new Error("Share a meal proposal instead. Your buddy must review and accept it before it is logged.");
}
