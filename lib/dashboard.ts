import { prisma } from "@/lib/db";
import { addNutrients, safeNutrientsForEntry, type Nutrients } from "@/lib/nutrition";
import { gradeMeal } from "@/lib/meal-scoring";
import { isoDaysBack } from "@/lib/dates";
import type { FrequentFood } from "@/components/FrequentMeals";

export const MEAL_META: Record<string, { label: string; icon: string }> = {
  BREAKFAST: { label: "Breakfast", icon: "🌅" },
  LUNCH: { label: "Lunch", icon: "☀️" },
  DINNER: { label: "Dinner", icon: "🌙" },
  SNACK: { label: "Snacks", icon: "🍎" },
  CUSTOM: { label: "Custom", icon: "✨" },
};

export function emptyTotals(): Nutrients {
  return { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, sodium_mg: 0 };
}

export async function getTodayDashboardData(userId: string, today: string) {
  const yesterday = isoDaysBack(1);

  const [profile, workouts, entries, water, yesterdayEntries, frequentRaw] = await Promise.all([
    prisma.profile.findUnique({ where: { userId } }),
    prisma.workoutEntry.findMany({ where: { userId, date: today } }),
    prisma.logEntry.findMany({
      where: { userId, date: today },
      include: { food: true, reactions: { include: { user: { select: { id: true, username: true } } } } },
      orderBy: [{ mealType: "asc" }, { createdAt: "asc" }],
    }),
    prisma.waterEntry.findUnique({ where: { userId_date: { userId, date: today } } }),
    prisma.logEntry.findMany({
      where: { userId, date: yesterday },
      include: { food: true },
    }),
    prisma.logEntry.groupBy({
      by: ["foodId"],
      where: { userId },
      _count: { foodId: true },
      orderBy: { _count: { foodId: "desc" } },
      take: 8,
    }),
  ]);

  const totalBurned = workouts.reduce((s, e) => s + e.caloriesBurned, 0);

  // Group today's entries by meal
  const byMeal = new Map<string, typeof entries>();
  for (const e of entries) {
    const arr = byMeal.get(e.mealType) ?? [];
    arr.push(e);
    byMeal.set(e.mealType, arr);
  }

  const dayTotals = entries.reduce((acc, e) => {
    const n = safeNutrientsForEntry(e, e.food);
    return n ? addNutrients(acc, n) : acc;
  }, emptyTotals());

  const mealsWithEntries = Array.from(byMeal.entries()).map(([key, mealEntries]) => ({
    key,
    entries: mealEntries,
    ...(MEAL_META[key] ?? { label: key, icon: "🍽️" }),
  }));

  // Yesterday for copy feature
  const yesterdayByMeal = new Map<string, typeof yesterdayEntries>();
  for (const e of yesterdayEntries) {
    const arr = yesterdayByMeal.get(e.mealType) ?? [];
    arr.push(e);
    yesterdayByMeal.set(e.mealType, arr);
  }

  const copyableMeals = Array.from(yesterdayByMeal.entries())
    .filter(([mealType]) => !byMeal.has(mealType))
    .map(([mealType, mealEntries]) => {
      const totalKcal = mealEntries.reduce((sum, e) => {
        const n = safeNutrientsForEntry(e, e.food);
        return sum + (n?.kcal ?? 0);
      }, 0);
      const meta = MEAL_META[mealType] ?? { label: mealType, icon: "🍽️" };
      return { mealType, label: meta.label, icon: meta.icon, itemCount: mealEntries.length, totalKcal };
    });

  // Frequent meals — batched query, no N+1
  const frequentFoodIds = frequentRaw.map((f) => f.foodId);
  const [frequentFoods, recentEntries] = frequentFoodIds.length > 0
    ? await Promise.all([
        prisma.food.findMany({ where: { id: { in: frequentFoodIds } } }),
        prisma.logEntry.findMany({
          where: { userId, foodId: { in: frequentFoodIds } },
          orderBy: { createdAt: "desc" },
        }),
      ])
    : [[], [] as typeof entries];

  const lastByFoodId = new Map<string, typeof recentEntries[0]>();
  for (const e of recentEntries) {
    if (!lastByFoodId.has(e.foodId)) lastByFoodId.set(e.foodId, e);
  }

  const frequentMeals: FrequentFood[] = [];
  for (const fg of frequentRaw) {
    const food = frequentFoods.find((f) => f.id === fg.foodId);
    const lastEntry = lastByFoodId.get(fg.foodId);
    if (!food || !lastEntry) continue;
    frequentMeals.push({
      foodId: food.id,
      name: food.name,
      count: fg._count.foodId,
      lastAmount: lastEntry.amount,
      lastUnit: lastEntry.unit,
      lastMealType: lastEntry.mealType,
      kcalPer100g: food.kcalPer100g,
      proteinPer100g: food.proteinPer100g,
    });
  }

  // Meal grading
  const targets = profile
    ? { kcalTarget: profile.kcalTarget, proteinTarget: profile.proteinTarget, carbsTarget: profile.carbsTarget, fatTarget: profile.fatTarget, fiberTarget: profile.fiberTarget ?? 30 }
    : null;

  const mealGrades = new Map<string, string>();
  if (targets) {
    let running = emptyTotals();
    for (const m of mealsWithEntries) {
      const mealNutrients = m.entries.reduce((acc, e) => {
        const n = safeNutrientsForEntry(e, e.food);
        return n ? addNutrients(acc, n) : acc;
      }, emptyTotals());
      mealGrades.set(m.key, gradeMeal(mealNutrients, running, targets));
      running = addNutrients(running, mealNutrients);
    }
  }

  const kcalTarget = profile?.kcalTarget ?? 2000;
  const kcalPct = Math.min(100, Math.round((dayTotals.kcal / kcalTarget) * 100));
  const kcalDiff = kcalTarget - dayTotals.kcal;

  return {
    profile,
    entries,
    water,
    dayTotals,
    mealsWithEntries,
    copyableMeals,
    frequentMeals,
    yesterday,
    mealGrades,
    targets,
    totalBurned,
    kcalTarget,
    kcalPct,
    kcalDiff,
    remainingKcal: Math.max(0, kcalTarget - dayTotals.kcal),
    remainingProtein: Math.max(0, (profile?.proteinTarget ?? 120) - dayTotals.protein_g),
    remainingCarbs: Math.max(0, (profile?.carbsTarget ?? 250) - dayTotals.carbs_g),
    remainingFat: Math.max(0, (profile?.fatTarget ?? 70) - dayTotals.fat_g),
  };
}
