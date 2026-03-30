"use server";

import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";

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
};

export async function searchFoods(query: string): Promise<FoodSearchResult[]> {
  const user = await requireSession();
  if (query.trim().length < 1) return [];

  const foods = await prisma.food.findMany({
    where: {
      name: { contains: query, mode: "insensitive" },
      logEntries: { some: { userId: user.id } },
    },
    orderBy: { logEntries: { _count: "desc" } },
    take: 8,
    include: {
      logEntries: {
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { amount: true, mealType: true },
      },
    },
  });

  return foods.map((f) => ({
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
  }));
}
