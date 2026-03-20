import { Card } from "@/components/Card";
import {
  applyEstimatedMeal,
  createManualFoodAndLogEntry,
  deleteLogEntry,
} from "@/app/actions/logging";
import { prisma } from "@/lib/db";
import { addNutrients, round0, round1, safeNutrientsForEntry, type Nutrients } from "@/lib/nutrition";
import { requireSession } from "@/lib/session";
import { BuddyTodayFeed } from "@/components/BuddyTodayFeed";
import { todayIsoDate, isoDaysBack } from "@/lib/dates";
import { gradeMeal, gradeColor } from "@/lib/meal-scoring";
import { WaterTracker } from "@/components/WaterTracker";
import { LogSection } from "@/components/LogSection";
import type { FrequentFood } from "@/components/FrequentMeals";
import Link from "next/link";

const MEAL_META: Record<string, { label: string; icon: string }> = {
  BREAKFAST: { label: "Breakfast", icon: "🌅" },
  LUNCH: { label: "Lunch", icon: "☀️" },
  DINNER: { label: "Dinner", icon: "🌙" },
  SNACK: { label: "Snacks", icon: "🍎" },
  CUSTOM: { label: "Custom", icon: "✨" },
};

function emptyTotals(): Nutrients {
  return { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, sodium_mg: 0 };
}

export default async function TodayPage() {
  const user = await requireSession();
  const today = todayIsoDate();
  const yesterday = isoDaysBack(1);

  const [profile, workouts, entries, water, yesterdayEntries, frequentRaw] = await Promise.all([
    prisma.profile.findUnique({ where: { userId: user.id } }),
    prisma.workoutEntry.findMany({ where: { userId: user.id, date: today } }),
    prisma.logEntry.findMany({
      where: { userId: user.id, date: today },
      include: { food: true, reactions: { include: { user: { select: { id: true, username: true } } } } },
      orderBy: [{ mealType: "asc" }, { createdAt: "asc" }],
    }),
    prisma.waterEntry.findUnique({ where: { userId_date: { userId: user.id, date: today } } }),
    prisma.logEntry.findMany({
      where: { userId: user.id, date: yesterday },
      include: { food: true },
    }),
    prisma.logEntry.groupBy({
      by: ["foodId"],
      where: { userId: user.id },
      _count: { foodId: true },
      orderBy: { _count: { foodId: "desc" } },
      take: 8,
    }),
  ]);

  const totalBurned = workouts.reduce((s, e) => s + e.caloriesBurned, 0);

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

  const mealsWithEntries = Array.from(byMeal.entries()).map(([key, entries]) => ({
    key,
    entries,
    ...(MEAL_META[key] ?? { label: key, icon: "🍽️" }),
  }));

  const kcalTarget = profile?.kcalTarget ?? 2000;
  const kcalPct = Math.min(100, Math.round((Number(dayTotals.kcal) / kcalTarget) * 100));
  const kcalDiff = kcalTarget - Number(dayTotals.kcal);

  // --- Yesterday's meals for copy ---
  const yesterdayByMeal = new Map<string, typeof yesterdayEntries>();
  for (const e of yesterdayEntries) {
    const arr = yesterdayByMeal.get(e.mealType) ?? [];
    arr.push(e);
    yesterdayByMeal.set(e.mealType, arr);
  }

  const copyableMeals = Array.from(yesterdayByMeal.entries())
    .filter(([mealType]) => !byMeal.has(mealType))
    .map(([mealType, entries]) => {
      const totalKcal = entries.reduce((sum, e) => {
        const n = safeNutrientsForEntry(e, e.food);
        return sum + (n?.kcal ?? 0);
      }, 0);
      const meta = MEAL_META[mealType] ?? { label: mealType, icon: "🍽️" };
      return { mealType, label: meta.label, icon: meta.icon, itemCount: entries.length, totalKcal };
    });

  // --- Frequent meals ---
  const frequentFoodIds = frequentRaw.map((f) => f.foodId);
  const frequentFoods = frequentFoodIds.length > 0
    ? await prisma.food.findMany({ where: { id: { in: frequentFoodIds } } })
    : [];

  const frequentMeals: FrequentFood[] = [];
  for (const fg of frequentRaw) {
    const food = frequentFoods.find((f) => f.id === fg.foodId);
    if (!food) continue;
    const lastEntry = await prisma.logEntry.findFirst({
      where: { userId: user.id, foodId: fg.foodId },
      orderBy: { createdAt: "desc" },
    });
    if (!lastEntry) continue;
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

  // --- Meal scoring ---
  const targets = profile
    ? { kcalTarget: profile.kcalTarget, proteinTarget: profile.proteinTarget, carbsTarget: profile.carbsTarget, fatTarget: profile.fatTarget, fiberTarget: profile.fiberTarget ?? 30 }
    : null;

  const mealGrades = new Map<string, string>();
  if (targets) {
    let runningTotals = emptyTotals();
    for (const m of mealsWithEntries) {
      const mealNutrients = m.entries.reduce((acc, e) => {
        const n = safeNutrientsForEntry(e, e.food);
        return n ? addNutrients(acc, n) : acc;
      }, emptyTotals());
      const grade = gradeMeal(mealNutrients, runningTotals, targets);
      mealGrades.set(m.key, grade);
      runningTotals = addNutrients(runningTotals, mealNutrients);
    }
  }

  const remainingKcal = Math.max(0, (profile?.kcalTarget ?? 2000) - dayTotals.kcal);
  const remainingProtein = Math.max(0, (profile?.proteinTarget ?? 120) - dayTotals.protein_g);
  const remainingCarbs = Math.max(0, (profile?.carbsTarget ?? 250) - dayTotals.carbs_g);
  const remainingFat = Math.max(0, (profile?.fatTarget ?? 70) - dayTotals.fat_g);

  return (
    <div className="space-y-3">
      {/* Prompt to set targets */}
      {!profile && (
        <div className="rounded-2xl bg-brand-50/60 p-4 text-sm">
          <span className="text-brand-800 font-medium">Set your daily targets to track progress.</span>
          <Link href="/profile" className="ml-2 font-bold text-brand-600 underline underline-offset-2">
            Set up profile →
          </Link>
        </div>
      )}

      {/* ── Daily summary ── */}
      <Card>
        {/* Greeting + calorie ring */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <div className="text-lg font-bold text-gray-900">Hi, {user.name}</div>
            <div className="text-xs text-gray-400 mt-0.5">{today}</div>
          </div>
          <div className="relative flex items-center justify-center">
            <svg className="w-[72px] h-[72px] -rotate-90" viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="15.5" fill="none" stroke="#f3f4f6" strokeWidth="2.5" />
              <circle
                cx="18" cy="18" r="15.5" fill="none"
                stroke={kcalPct >= 100 ? "#ef4444" : "#10b981"}
                strokeWidth="2.5"
                strokeDasharray={`${kcalPct} ${100 - kcalPct}`}
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute text-center">
              <div className="text-xs font-bold tabular-nums leading-tight">{round0(dayTotals.kcal)}</div>
              <div className="text-[9px] text-gray-400 leading-tight">/ {round0(kcalTarget)}</div>
            </div>
          </div>
        </div>

        {/* Macro bars — compact */}
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: "Protein", value: dayTotals.protein_g, target: profile?.proteinTarget, goalType: "min" as const },
            { label: "Carbs", value: dayTotals.carbs_g, target: profile?.carbsTarget, goalType: "max" as const },
            { label: "Fat", value: dayTotals.fat_g, target: profile?.fatTarget, goalType: "max" as const },
            { label: "Fiber", value: dayTotals.fiber_g ?? 0, target: profile?.fiberTarget, goalType: "min" as const },
          ].map((m) => {
            const val = Number(m.value);
            const tgt = m.target ?? null;
            const pct = tgt ? Math.min(100, Math.round((val / tgt) * 100)) : 0;

            let barColor = "bg-gray-200";
            if (tgt !== null) {
              if (m.goalType === "min") {
                barColor = val >= tgt ? "bg-brand-400" : "bg-brand-200";
              } else {
                barColor = val > tgt ? "bg-red-400" : "bg-brand-300";
              }
            }

            return (
              <div key={m.label}>
                <div className="flex items-baseline justify-between mb-1">
                  <span className="text-[10px] text-gray-400">{m.label}</span>
                  <span className="text-[10px] font-medium tabular-nums text-gray-500">
                    {round1(val)}{tgt ? `/${round0(tgt)}` : ""}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>

        {/* Status line */}
        <div className="mt-3 flex items-center gap-3 text-xs text-gray-400">
          {kcalDiff >= 0
            ? <span className="tabular-nums">{round0(kcalDiff)} kcal left</span>
            : <span className="tabular-nums text-red-400">{round0(-kcalDiff)} over</span>
          }
          {totalBurned > 0 && (
            <span className="tabular-nums text-blue-400">{round0(totalBurned)} burned</span>
          )}
        </div>

        {/* Water — inline */}
        <div className="mt-3 pt-3 border-t border-gray-50">
          <WaterTracker glasses={water?.glasses ?? 0} date={today} />
        </div>
      </Card>

      {/* ── Log a meal (collapsed by default) ── */}
      <LogSection
        date={today}
        onApplyEstimate={applyEstimatedMeal}
        manualAction={createManualFoodAndLogEntry}
        copyableMeals={copyableMeals}
        yesterday={yesterday}
        frequentMeals={frequentMeals}
        remainingKcal={remainingKcal}
        remainingProtein={remainingProtein}
        remainingCarbs={remainingCarbs}
        remainingFat={remainingFat}
      />

      {/* ── Logged meals ── */}
      {mealsWithEntries.length > 0 && (
        <div className="space-y-2">
          {mealsWithEntries.map((m) => {
            const mealEntries = m.entries;
            const mealTotals = mealEntries.reduce((acc, e) => {
              const n = safeNutrientsForEntry(e, e.food);
              return n ? addNutrients(acc, n) : acc;
            }, emptyTotals());

            const grade = mealGrades.get(m.key);

            return (
              <div key={m.key} className="rounded-2xl bg-white border border-gray-100 p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span>{m.icon}</span>
                    <span className="text-sm font-semibold text-gray-700">{m.label}</span>
                    {grade && (
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold leading-none ${gradeColor(grade as "A" | "B" | "C" | "D")}`}>
                        {grade}
                      </span>
                    )}
                  </div>
                  <span className="text-xs font-medium tabular-nums text-gray-400">{round0(mealTotals.kcal)} cal</span>
                </div>
                <div className="space-y-1.5">
                  {mealEntries.map((e) => {
                    const n = safeNutrientsForEntry(e, e.food);
                    const reactions = (e.reactions ?? []) as { id: string; type: string; user: { username: string } }[];
                    return (
                      <div key={e.id} className="flex items-center justify-between gap-2 py-1.5 group">
                        <div className="min-w-0">
                          <div className="text-sm text-gray-700 truncate">
                            {e.food.name}
                            {e.food.brand && <span className="text-gray-300"> · {e.food.brand}</span>}
                          </div>
                          <div className="text-[11px] text-gray-400 tabular-nums">
                            {round1(e.amount)}{e.unit === "GRAM" ? "g" : " srv"}
                            {n ? <> · {round0(n.kcal)} · {round1(n.protein_g)}P {round1(n.carbs_g)}C {round1(n.fat_g)}F</> : ""}
                          </div>
                          {reactions.length > 0 && (
                            <div className="mt-1 flex items-center gap-1 flex-wrap">
                              {reactions.map((r) => (
                                <span key={r.id} className="text-[11px] text-gray-400">
                                  {r.type === "THUMBS_UP" ? "👍" : r.type === "THUMBS_DOWN" ? "👎" : r.type === "FIRE" ? "🔥" : "💪"}
                                  {r.user.username}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <form action={deleteLogEntry}>
                          <input type="hidden" name="id" value={e.id} />
                          <button className="rounded-lg p-1 text-gray-200 opacity-0 group-hover:opacity-100 hover:text-red-400 transition-all">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                          </button>
                        </form>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {entries.length === 0 && (
        <div className="text-center py-6 text-sm text-gray-300">
          No meals logged yet today.
        </div>
      )}

      {/* Buddy feed */}
      <BuddyTodayFeed currentUserId={user.id} date={today} />
    </div>
  );
}
