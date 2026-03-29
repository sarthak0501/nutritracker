"use server";

import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { MealType, AmountUnit } from "@prisma/client";
import { requireSession } from "@/lib/session";
import type { EstimateResponse } from "@/lib/llm";
import { todayIsoDate, isoDaysBack } from "@/lib/dates";

function parseNumber(v: FormDataEntryValue | null): number | null {
  if (!v) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function parseString(v: FormDataEntryValue | null): string | null {
  if (!v) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

const LogEntryFormSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mealType: z.nativeEnum(MealType),
  mealName: z.string().optional(),
  amount: z.number().positive(),
  unit: z.nativeEnum(AmountUnit),
});

export async function createManualFoodAndLogEntry(formData: FormData) {
  const user = await requireSession();

  const parsed = LogEntryFormSchema.safeParse({
    date: parseString(formData.get("date")),
    mealType: parseString(formData.get("mealType")),
    mealName: parseString(formData.get("mealName")) ?? undefined,
    amount: parseNumber(formData.get("amount")),
    unit: parseString(formData.get("unit")),
  });
  if (!parsed.success) throw new Error("Invalid form data");

  const kcalPer100g = parseNumber(formData.get("kcalPer100g"));
  const proteinPer100g = parseNumber(formData.get("proteinPer100g"));
  const carbsPer100g = parseNumber(formData.get("carbsPer100g"));
  const fatPer100g = parseNumber(formData.get("fatPer100g"));
  const name = parseString(formData.get("name"));

  if (!kcalPer100g || !proteinPer100g || !carbsPer100g || !fatPer100g || !name) {
    throw new Error("Missing required nutrition fields");
  }

  const food = await prisma.food.create({
    data: {
      name,
      brand: parseString(formData.get("brand")) ?? undefined,
      source: "MANUAL",
      createdByUserId: user.id,
      kcalPer100g,
      proteinPer100g,
      carbsPer100g,
      fatPer100g,
      fiberPer100g: parseNumber(formData.get("fiberPer100g")) ?? undefined,
      sodiumMgPer100g: parseNumber(formData.get("sodiumMgPer100g")) ?? undefined,
    },
  });

  const factor = parsed.data.amount / 100;
  await prisma.logEntry.create({
    data: {
      userId: user.id,
      date: parsed.data.date,
      mealType: parsed.data.mealType,
      mealName: parsed.data.mealName,
      amount: parsed.data.amount,
      unit: parsed.data.unit,
      foodId: food.id,
      snapshotKcal: kcalPer100g * factor,
      snapshotProteinG: proteinPer100g * factor,
      snapshotCarbsG: carbsPer100g * factor,
      snapshotFatG: fatPer100g * factor,
      snapshotFiberG: (parseNumber(formData.get("fiberPer100g")) ?? 0) * factor || undefined,
    },
  });

  revalidatePath("/");
  revalidatePath("/history");
}

export async function createLogEntryFromExistingFood(formData: FormData) {
  const user = await requireSession();

  const parsed = LogEntryFormSchema.safeParse({
    date: parseString(formData.get("date")),
    mealType: parseString(formData.get("mealType")),
    mealName: parseString(formData.get("mealName")) ?? undefined,
    amount: parseNumber(formData.get("amount")),
    unit: parseString(formData.get("unit")),
  });
  if (!parsed.success) throw new Error("Invalid form data");

  const foodId = parseString(formData.get("foodId"));
  if (!foodId) throw new Error("Missing foodId");

  const food = await prisma.food.findUnique({ where: { id: foodId } });
  if (!food) throw new Error("Food not found");

  await prisma.logEntry.create({
    data: {
      userId: user.id,
      date: parsed.data.date,
      mealType: parsed.data.mealType,
      mealName: parsed.data.mealName,
      amount: parsed.data.amount,
      unit: parsed.data.unit,
      foodId: food.id,
      isEstimated: false,
    },
  });

  revalidatePath("/");
  revalidatePath("/history");
}

export async function deleteLogEntry(formData: FormData) {
  const user = await requireSession();
  const id = parseString(formData.get("id"));
  if (!id) throw new Error("Missing id");

  await prisma.logEntry.deleteMany({ where: { id, userId: user.id } });

  revalidatePath("/");
  revalidatePath("/history");
}

export async function applyEstimatedMeal(input: {
  date: string;
  mealType: string;
  mealName?: string;
  estimate: EstimateResponse;
  sourceText: string;
}) {
  const user = await requireSession();
  const mealType = input.mealType as MealType;

  for (const item of input.estimate.items) {
    const per100 = item.quantity > 0 ? 100 / item.quantity : 1;

    const food = await prisma.food.create({
      data: {
        name: item.description,
        source: "LLM",
        createdByUserId: user.id,
        kcalPer100g: item.nutrients.kcal * per100,
        proteinPer100g: item.nutrients.protein_g * per100,
        carbsPer100g: item.nutrients.carbs_g * per100,
        fatPer100g: item.nutrients.fat_g * per100,
        fiberPer100g: item.nutrients.fiber_g != null ? item.nutrients.fiber_g * per100 : undefined,
        sodiumMgPer100g: item.nutrients.sodium_mg != null ? item.nutrients.sodium_mg * per100 : undefined,
      },
    });

    await prisma.logEntry.create({
      data: {
        userId: user.id,
        date: input.date,
        mealType,
        mealName: input.mealName,
        amount: item.quantity,
        unit: "GRAM",
        foodId: food.id,
        isEstimated: true,
        sourceText: input.sourceText,
        estimationMeta: {
          confidence: item.confidence,
          assumptions: item.assumptions,
          originalQuantity: item.quantity,
          originalUnit: item.unit,
        },
        snapshotKcal: item.nutrients.kcal,
        snapshotProteinG: item.nutrients.protein_g,
        snapshotCarbsG: item.nutrients.carbs_g,
        snapshotFatG: item.nutrients.fat_g,
        snapshotFiberG: item.nutrients.fiber_g ?? undefined,
      },
    });
  }

  revalidatePath("/");
  revalidatePath("/history");
}

export async function applyEstimatedDay(input: {
  date: string;
  meals: Array<{
    mealType: string;
    mealName?: string | null;
    detectedFrom?: string;
    items: Array<{
      description: string;
      quantity: number;
      unit: string;
      nutrients: {
        kcal: number;
        protein_g: number;
        carbs_g: number;
        fat_g: number;
        fiber_g?: number;
      };
      confidence: number;
      assumptions: string[];
    }>;
  }>;
  sourceText: string;
}) {
  const user = await requireSession();

  await prisma.$transaction(async (tx) => {
    for (const meal of input.meals) {
      const mealType = meal.mealType as MealType;
      for (const item of meal.items) {
        const per100 = item.quantity > 0 ? 100 / item.quantity : 1;
        const food = await tx.food.create({
          data: {
            name: item.description,
            source: "LLM",
            createdByUserId: user.id,
            kcalPer100g: item.nutrients.kcal * per100,
            proteinPer100g: item.nutrients.protein_g * per100,
            carbsPer100g: item.nutrients.carbs_g * per100,
            fatPer100g: item.nutrients.fat_g * per100,
            fiberPer100g: item.nutrients.fiber_g != null ? item.nutrients.fiber_g * per100 : undefined,
          },
        });

        await tx.logEntry.create({
          data: {
            userId: user.id,
            date: input.date,
            mealType,
            mealName: meal.mealName ?? undefined,
            amount: item.quantity,
            unit: "GRAM",
            foodId: food.id,
            isEstimated: true,
            sourceText: input.sourceText,
            estimationMeta: {
              confidence: item.confidence,
              assumptions: item.assumptions,
              originalQuantity: item.quantity,
              originalUnit: item.unit,
              detectedFrom: meal.detectedFrom,
            },
            snapshotKcal: item.nutrients.kcal,
            snapshotProteinG: item.nutrients.protein_g,
            snapshotCarbsG: item.nutrients.carbs_g,
            snapshotFatG: item.nutrients.fat_g,
            snapshotFiberG: item.nutrients.fiber_g ?? undefined,
          },
        });
      }
    }
  });

  revalidatePath("/");
  revalidatePath("/history");
}

export async function copyMealFromDate(input: {
  fromDate: string;
  toDate: string;
  mealType: string;
}) {
  const user = await requireSession();

  const entries = await prisma.logEntry.findMany({
    where: { userId: user.id, date: input.fromDate, mealType: input.mealType as MealType },
    include: { food: true },
  });

  if (entries.length === 0) return;

  for (const e of entries) {
    await prisma.logEntry.create({
      data: {
        userId: user.id,
        date: input.toDate,
        mealType: e.mealType,
        mealName: e.mealName,
        amount: e.amount,
        unit: e.unit,
        foodId: e.foodId,
        isEstimated: e.isEstimated,
      },
    });
  }

  revalidatePath("/");
  revalidatePath("/history");
}

export async function quickLogFood(input: {
  date: string;
  foodId: string;
  amount: number;
  unit: string;
  mealType: string;
}) {
  const user = await requireSession();

  await prisma.logEntry.create({
    data: {
      userId: user.id,
      date: input.date,
      mealType: input.mealType as MealType,
      amount: input.amount,
      unit: input.unit as AmountUnit,
      foodId: input.foodId,
    },
  });

  revalidatePath("/");
  revalidatePath("/history");
}
