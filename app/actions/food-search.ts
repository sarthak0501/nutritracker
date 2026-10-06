"use server";

import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { entryAmountLabel, isLegacyPortion } from "@/lib/meal-units";
import { safeNutrientsForEntry, type Nutrients } from "@/lib/nutrition";

export type FoodSearchResult = {
  id: string;
  name: string;
  brand: string | null;
  kcalPer100g: number;
  proteinPer100g: number;
  carbsPer100g: number;
  fatPer100g: number;
  fiberPer100g: number | null;
  lastAmount: number;
  lastMealType: string;
  lastUnit: string;
  lastEntryId: string;
  isLegacyPortion: boolean;
  portionLabel: string;
  lastNutrients: Nutrients | null;
};

export async function searchFoods(query: string): Promise<FoodSearchResult[]> {
  const user = await requireSession();
  if (typeof query !== "string" || query.trim().length < 1) return [];
  const search = query.trim().slice(0, 200);

  const foods = await prisma.food.findMany({
    where: {
      name: { contains: search, mode: "insensitive" },
      logEntries: { some: { userId: user.id } },
    },
    orderBy: { logEntries: { _count: "desc" } },
    take: 8,
    include: {
      logEntries: {
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  return foods.filter((food) => food.logEntries.length > 0).map((f) => ({
    id: f.id,
    name: f.name,
    brand: f.brand,
    kcalPer100g: f.kcalPer100g,
    proteinPer100g: f.proteinPer100g,
    carbsPer100g: f.carbsPer100g,
    fatPer100g: f.fatPer100g,
    fiberPer100g: f.fiberPer100g,
    lastAmount: f.logEntries[0]?.amount ?? 100,
    lastMealType: f.logEntries[0]?.mealType ?? "BREAKFAST",
    lastUnit: f.logEntries[0].unit,
    lastEntryId: f.logEntries[0].id,
    isLegacyPortion: isLegacyPortion(f.logEntries[0], f),
    portionLabel: entryAmountLabel(f.logEntries[0], f),
    lastNutrients: safeNutrientsForEntry(f.logEntries[0], f),
  }));
}
