import { Card } from "@/components/Card";
import { LogMealTabs } from "@/components/LogMealTabs";
import {
  applyEstimatedMeal,
  createManualFoodAndLogEntry,
  deleteLogEntry,
} from "@/app/actions/logging";
import { prisma } from "@/lib/db";
import { addNutrients, round0, round1, safeNutrientsForEntry, type Nutrients } from "@/lib/nutrition";
import { requireSession } from "@/lib/session";
import { BuddyTodayFeed } from "@/components/BuddyTodayFeed";
import Link from "next/link";

const MEALS = [
  { key: "BREAKFAST", label: "Breakfast" },
  { key: "LUNCH", label: "Lunch" },
  { key: "DINNER", label: "Dinner" },
  { key: "SNACK", label: "Snacks" },
] as const;

function emptyTotals(): Nutrients {
  return { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, sodium_mg: 0 };
}

export default async function TodayPage() {
  const user = await requireSession();
  const today = new Date().toISOString().slice(0, 10);

  const profile = await prisma.profile.findUnique({ where: { userId: user.id } });

  const workouts = await prisma.workoutEntry.findMany({
    where: { userId: user.id, date: today },
  });
  const totalBurned = workouts.reduce((s, e) => s + e.caloriesBurned, 0);

  const entries = await prisma.logEntry.findMany({
    where: { userId: user.id, date: today },
    include: { food: true, reactions: { include: { user: { select: { id: true, username: true } } } } },
    orderBy: [{ mealType: "asc" }, { createdAt: "asc" }],
  });

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

  const mealsWithEntries = MEALS.filter((m) => (byMeal.get(m.key)?.length ?? 0) > 0);

  return (
    <div className="space-y-4">
      {/* Prompt to set targets if no profile exists */}
      {!profile && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
          <span className="text-amber-800">Set your daily nutrition targets to track progress.</span>
          <Link href="/profile" className="ml-2 font-medium text-amber-900 underline">
            Set targets →
          </Link>
        </div>
      )}

      {/* Compact daily summary */}
      <Card>
        <div className="flex items-baseline justify-between">
          <div className="text-sm text-slate-500">{today} · {user.name}</div>
          <div className="text-xl font-bold tabular-nums">{round0(dayTotals.kcal)} <span className="text-sm font-normal text-slate-400">kcal</span></div>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600 tabular-nums">
          <span>{round1(dayTotals.protein_g)}g protein</span>
          <span>{round1(dayTotals.carbs_g)}g carbs</span>
          <span>{round1(dayTotals.fat_g)}g fat</span>
          <span>{round1(dayTotals.fiber_g ?? 0)}g fiber</span>
        </div>
        {totalBurned > 0 && (
          <div className="mt-1.5 text-xs text-slate-500 tabular-nums">
            🏋️ {round0(totalBurned)} kcal burned · Net: {round0(Number(dayTotals.kcal) - totalBurned)} kcal
          </div>
        )}
        {profile && (
          <div className="mt-1.5 text-xs text-slate-400 tabular-nums">
            {round0(profile.kcalTarget - Number(dayTotals.kcal))} kcal remaining · {round1(profile.proteinTarget - Number(dayTotals.protein_g))}P / {round1(profile.carbsTarget - Number(dayTotals.carbs_g))}C / {round1(profile.fatTarget - Number(dayTotals.fat_g))}F
          </div>
        )}
      </Card>

      {/* Log a meal — tabbed: AI Estimate | Manual Entry */}
      <Card title="Log a meal">
        <LogMealTabs
          date={today}
          onApplyEstimate={applyEstimatedMeal}
          manualAction={createManualFoodAndLogEntry}
        />
      </Card>

      {/* Logged meals — only show meals that have entries */}
      {mealsWithEntries.length > 0 && (
        <div className="space-y-3">
          {mealsWithEntries.map((m) => {
            const mealEntries = byMeal.get(m.key)!;
            const mealTotals = mealEntries.reduce((acc, e) => {
              const n = safeNutrientsForEntry(e, e.food);
              return n ? addNutrients(acc, n) : acc;
            }, emptyTotals());

            return (
              <Card key={m.key} title={`${m.label} · ${round0(mealTotals.kcal)} kcal`}>
                <div className="space-y-2">
                  {mealEntries.map((e) => {
                    const n = safeNutrientsForEntry(e, e.food);
                    const reactions = (e.reactions ?? []) as { id: string; type: string; user: { username: string } }[];
                    return (
                      <div key={e.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">
                              {e.food.name}
                              {e.food.brand && <span className="font-normal text-slate-400"> ({e.food.brand})</span>}
                            </div>
                            <div className="text-xs text-slate-500 tabular-nums">
                              {round1(e.amount)}{e.unit === "GRAM" ? "g" : " srv"}
                              {n ? <> · {round0(n.kcal)} kcal · {round1(n.protein_g)}P / {round1(n.carbs_g)}C / {round1(n.fat_g)}F</> : ""}
                            </div>
                          </div>
                          <form action={deleteLogEntry}>
                            <input type="hidden" name="id" value={e.id} />
                            <button className="text-xs text-slate-400 hover:text-red-500">×</button>
                          </form>
                        </div>
                        {reactions.length > 0 && (
                          <div className="mt-2 flex items-center gap-1 flex-wrap">
                            {reactions.map((r) => (
                              <span key={r.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600" title={`${r.user.username}`}>
                                {r.type === "THUMBS_UP" ? "👍" : r.type === "THUMBS_DOWN" ? "👎" : r.type === "FIRE" ? "🔥" : "💪"}
                                <span className="text-slate-400">{r.user.username}</span>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {entries.length === 0 && (
        <div className="text-center py-6 text-sm text-slate-400">
          No meals logged yet today. Use the form above to get started.
        </div>
      )}

      {/* Buddy feed */}
      <BuddyTodayFeed currentUserId={user.id} date={today} />
    </div>
  );
}
