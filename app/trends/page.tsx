import Link from "next/link";
import { Card } from "@/components/Card";
import {
  NutritionChart,
  WorkoutChart,
  type TrendPoint,
  type WorkoutTrendPoint,
} from "@/components/TrendsChart";
import { prisma } from "@/lib/db";
import { addNutrients, safeNutrientsForEntry } from "@/lib/nutrition";
import { isoDaysBack, lastIsoDates } from "@/lib/dates";
import { requireSession } from "@/lib/session";

function empty() {
  return { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, sodium_mg: 0 };
}

function toFixed1(n: number) {
  return Math.round(n * 10) / 10;
}

export default async function TrendsPage({
  searchParams,
}: {
  searchParams?: Promise<{ range?: string }>;
}) {
  const user = await requireSession();
  const sp = (await searchParams) ?? {};
  const range = sp.range === "7" ? 7 : 30;
  const fromDate = isoDaysBack(range - 1);
  const days = lastIsoDates(range);

  const profile = await prisma.profile.findUnique({ where: { userId: user.id } });

  // Fetch nutrition entries
  const entries = await prisma.logEntry.findMany({
    where: { userId: user.id, date: { gte: fromDate } },
    include: { food: true },
  });

  // Fetch workout entries
  const workouts = await prisma.workoutEntry.findMany({
    where: { userId: user.id, date: { gte: fromDate } },
  });

  // --- Nutrition data ---
  const totalsByDate = new Map<string, ReturnType<typeof empty>>();
  for (const d of days) totalsByDate.set(d, empty());

  for (const e of entries) {
    const n = safeNutrientsForEntry(e, e.food);
    if (!n) continue;
    const existing = totalsByDate.get(e.date) ?? empty();
    totalsByDate.set(e.date, addNutrients(existing, n) as ReturnType<typeof empty>);
  }

  const nutritionData: TrendPoint[] = days.map((d) => {
    const t = totalsByDate.get(d) ?? empty();
    return {
      date: d,
      kcal: Math.round(t.kcal),
      protein_g: toFixed1(t.protein_g),
      fiber_g: toFixed1(t.fiber_g ?? 0),
    };
  });

  // --- Workout data ---
  const workoutByDate = new Map<string, { burned: number; count: number; volume: number }>();
  for (const d of days) workoutByDate.set(d, { burned: 0, count: 0, volume: 0 });

  for (const w of workouts) {
    const existing = workoutByDate.get(w.date) ?? { burned: 0, count: 0, volume: 0 };
    const vol = (w.weightKg ?? 0) * (w.sets ?? 0) * (w.reps ?? 0);
    existing.burned += w.caloriesBurned;
    existing.count += 1;
    existing.volume += vol;
    workoutByDate.set(w.date, existing);
  }

  const workoutData: WorkoutTrendPoint[] = days.map((d) => {
    const t = workoutByDate.get(d) ?? { burned: 0, count: 0, volume: 0 };
    return {
      date: d,
      caloriesBurned: Math.round(t.burned),
      exerciseCount: t.count,
      totalWeightKg: Math.round(t.volume),
    };
  });

  // --- Averages ---
  const daysWithFood = nutritionData.filter((d) => d.kcal > 0).length || 1;
  const daysWithWorkout = workoutData.filter((d) => d.caloriesBurned > 0).length || 1;

  const nutritionSum = nutritionData.reduce(
    (acc, p) => {
      acc.kcal += p.kcal;
      acc.protein += p.protein_g;
      acc.fiber += p.fiber_g;
      return acc;
    },
    { kcal: 0, protein: 0, fiber: 0 }
  );

  const workoutSum = workoutData.reduce(
    (acc, p) => {
      acc.burned += p.caloriesBurned;
      acc.exercises += p.exerciseCount;
      acc.volume += p.totalWeightKg;
      return acc;
    },
    { burned: 0, exercises: 0, volume: 0 }
  );

  const avgNutrition = {
    kcal: Math.round(nutritionSum.kcal / daysWithFood),
    protein: toFixed1(nutritionSum.protein / daysWithFood),
    fiber: toFixed1(nutritionSum.fiber / daysWithFood),
  };

  const avgWorkout = {
    burned: Math.round(workoutSum.burned / daysWithWorkout),
    volume: Math.round(workoutSum.volume / daysWithWorkout),
    activeDays: workoutData.filter((d) => d.caloriesBurned > 0).length,
  };

  // --- Goal progress ---
  const hasGoals = !!profile;
  const todayNutrition = nutritionData[nutritionData.length - 1];
  const todayWorkout = workoutData[workoutData.length - 1];

  type GoalItem = { label: string; current: number; target: number; unit: string };
  const goals: GoalItem[] = [];
  if (profile) {
    goals.push({ label: "Calories", current: todayNutrition?.kcal ?? 0, target: profile.kcalTarget, unit: "kcal" });
    goals.push({ label: "Protein", current: todayNutrition?.protein_g ?? 0, target: profile.proteinTarget, unit: "g" });
    goals.push({ label: "Carbs", current: Math.round((totalsByDate.get(days[days.length - 1]) ?? empty()).carbs_g), target: profile.carbsTarget, unit: "g" });
    goals.push({ label: "Fat", current: Math.round((totalsByDate.get(days[days.length - 1]) ?? empty()).fat_g), target: profile.fatTarget, unit: "g" });
  }

  return (
    <div className="space-y-4">
      {/* Header + range toggle */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold">Trends</div>
            <div className="mt-1 text-sm text-slate-500">
              {range}-day overview of nutrition and training.
            </div>
          </div>
          <div className="flex gap-2">
            <Link
              href="/trends?range=7"
              className={`rounded-lg border px-3 py-1.5 text-sm ${
                range === 7 ? "bg-slate-900 text-white border-slate-900" : "border-slate-200 hover:bg-slate-50"
              }`}
            >
              7d
            </Link>
            <Link
              href="/trends?range=30"
              className={`rounded-lg border px-3 py-1.5 text-sm ${
                range === 30 ? "bg-slate-900 text-white border-slate-900" : "border-slate-200 hover:bg-slate-50"
              }`}
            >
              30d
            </Link>
          </div>
        </div>
      </Card>

      {/* Today's goal progress */}
      {hasGoals && (
        <Card title="Today's goals">
          <div className="grid gap-2">
            {goals.map((g) => {
              const pct = g.target > 0 ? Math.min(100, Math.round((g.current / g.target) * 100)) : 0;
              const over = g.current > g.target;
              return (
                <div key={g.label}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-slate-600">{g.label}</span>
                    <span className="tabular-nums text-xs text-slate-500">
                      {g.current} / {Math.round(g.target)} {g.unit}
                      {over && <span className="ml-1 text-amber-600">(over)</span>}
                    </span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        over ? "bg-amber-400" : pct >= 80 ? "bg-green-500" : "bg-slate-400"
                      }`}
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                </div>
              );
            })}
            {todayWorkout && todayWorkout.caloriesBurned > 0 && (
              <div className="mt-1 text-xs text-slate-500">
                Net calories today: {(todayNutrition?.kcal ?? 0) - todayWorkout.caloriesBurned} kcal
                ({todayWorkout.caloriesBurned} burned)
              </div>
            )}
          </div>
        </Card>
      )}

      {!hasGoals && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
          <span className="text-amber-800">Set daily targets in </span>
          <Link href="/profile" className="font-medium text-amber-900 underline">Profile</Link>
          <span className="text-amber-800"> to track goal progress here.</span>
        </div>
      )}

      {/* Nutrition trends */}
      <Card title="Nutrition">
        <div className="grid gap-2 md:grid-cols-3 mb-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs text-slate-500">Avg calories</div>
            <div className="mt-1 text-lg font-semibold tabular-nums">{avgNutrition.kcal} kcal</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs text-slate-500">Avg protein</div>
            <div className="mt-1 text-lg font-semibold tabular-nums">{avgNutrition.protein} g</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs text-slate-500">Avg fiber</div>
            <div className="mt-1 text-lg font-semibold tabular-nums">{avgNutrition.fiber} g</div>
          </div>
        </div>
        <NutritionChart data={nutritionData} />
      </Card>

      {/* Workout trends */}
      <Card title="Training">
        <div className="grid gap-2 md:grid-cols-3 mb-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs text-slate-500">Avg cal burned</div>
            <div className="mt-1 text-lg font-semibold tabular-nums">{avgWorkout.burned} kcal</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs text-slate-500">Avg volume</div>
            <div className="mt-1 text-lg font-semibold tabular-nums">{avgWorkout.volume} kg</div>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs text-slate-500">Active days</div>
            <div className="mt-1 text-lg font-semibold tabular-nums">{avgWorkout.activeDays} / {range}</div>
          </div>
        </div>
        <WorkoutChart data={workoutData} />
      </Card>

      {/* Weekly summary (for 30d view) */}
      {range === 30 && (
        <Card title="Weekly breakdown">
          <div className="space-y-3">
            {[0, 1, 2, 3].map((weekIdx) => {
              const weekDays = days.slice(weekIdx * 7, (weekIdx + 1) * 7);
              if (weekDays.length === 0) return null;

              const weekNutrition = weekDays.reduce(
                (acc, d) => {
                  const t = totalsByDate.get(d) ?? empty();
                  acc.kcal += t.kcal;
                  acc.protein += t.protein_g;
                  return acc;
                },
                { kcal: 0, protein: 0 }
              );

              const weekWorkout = weekDays.reduce(
                (acc, d) => {
                  const t = workoutByDate.get(d) ?? { burned: 0, count: 0, volume: 0 };
                  acc.burned += t.burned;
                  acc.volume += t.volume;
                  acc.sessions += t.count > 0 ? 1 : 0;
                  return acc;
                },
                { burned: 0, volume: 0, sessions: 0 }
              );

              const weekLabel = `${weekDays[0]?.slice(5)} – ${weekDays[weekDays.length - 1]?.slice(5)}`;

              return (
                <div key={weekIdx} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="text-xs text-slate-500 mb-1">{weekLabel}</div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums">
                    <span>{Math.round(weekNutrition.kcal / weekDays.length)} kcal/day avg</span>
                    <span>{toFixed1(weekNutrition.protein / weekDays.length)}g protein/day</span>
                    <span>{Math.round(weekWorkout.burned)} kcal burned</span>
                    <span>{Math.round(weekWorkout.volume)}kg volume</span>
                    <span>{weekWorkout.sessions} workout days</span>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
