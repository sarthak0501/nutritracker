import Link from "next/link";
import { Card } from "@/components/Card";
import {
  NutritionChart,
  WorkoutChart,
  WeightChart,
  type TrendPoint,
  type WorkoutTrendPoint,
  type WeightTrendPoint,
} from "@/components/TrendsChart";
import { WeeklySummary } from "@/components/WeeklySummary";
import { CalendarHeatmap } from "@/components/CalendarHeatmap";
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

  // Fetch weight entries
  const weightEntries = await prisma.weightEntry.findMany({
    where: { userId: user.id, date: { gte: fromDate } },
    orderBy: { date: "asc" },
  });

  // --- Nutrition data ---
  const totalsByDate = new Map<string, ReturnType<typeof empty>>();

  for (const e of entries) {
    const n = safeNutrientsForEntry(e, e.food);
    if (!n) continue;
    const existing = totalsByDate.get(e.date) ?? empty();
    totalsByDate.set(e.date, addNutrients(existing, n) as ReturnType<typeof empty>);
  }

  const nutritionData: TrendPoint[] = days.map((d) => {
    const t = totalsByDate.get(d);
    if (!t) return { date: d, kcal: null, protein_g: null, carbs_g: null, fat_g: null, fiber_g: null };
    return {
      date: d,
      kcal: Math.round(t.kcal),
      protein_g: toFixed1(t.protein_g),
      carbs_g: toFixed1(t.carbs_g),
      fat_g: toFixed1(t.fat_g),
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
  const daysWithFood = nutritionData.filter((d) => d.kcal !== null).length || 1;
  const daysWithWorkout = workoutData.filter((d) => d.caloriesBurned > 0).length || 1;

  const nutritionSum = nutritionData.reduce(
    (acc, p) => {
      if (p.kcal === null) return acc;
      acc.kcal += p.kcal;
      acc.protein += p.protein_g ?? 0;
      acc.fiber += p.fiber_g ?? 0;
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

  // --- Weight data ---
  const weightData: WeightTrendPoint[] = weightEntries.map((w) => ({
    date: w.date,
    weightKg: toFixed1(w.weightKg),
  }));

  const weightChange =
    weightData.length >= 2
      ? toFixed1(weightData[weightData.length - 1].weightKg - weightData[0].weightKg)
      : null;

  const hasGoals = !!profile;

  // Insight text
  const proteinGoalMet = daysWithFood > 0 && profile ? avgNutrition.protein >= profile.proteinTarget * 0.9 : false;
  const consistentTraining = avgWorkout.activeDays >= (range === 7 ? 3 : 12);

  return (
    <div className="space-y-4">
      {/* Header + range toggle */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-lg font-bold">Your progress</div>
            <div className="mt-1 text-sm text-gray-500">
              {range}-day overview of nutrition and training
            </div>
          </div>
          <div className="flex rounded-xl bg-surface-muted p-1">
            <Link
              href="/trends?range=7"
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-all ${
                range === 7 ? "bg-gray-900 text-white shadow-sm" : "text-gray-400 hover:text-gray-700"
              }`}
            >
              7d
            </Link>
            <Link
              href="/trends?range=30"
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-all ${
                range === 30 ? "bg-gray-900 text-white shadow-sm" : "text-gray-400 hover:text-gray-700"
              }`}
            >
              30d
            </Link>
          </div>
        </div>

        {/* Quick insights */}
        {hasGoals && (
          <div className="mt-3 flex flex-wrap gap-2">
            {proteinGoalMet && (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700">
                ✓ Hitting protein goals
              </span>
            )}
            {consistentTraining && (
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
                ✓ Consistent training
              </span>
            )}
            {weightChange !== null && (
              <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
                weightChange < 0 ? "bg-green-50 text-green-700" : weightChange > 0 ? "bg-amber-50 text-amber-700" : "bg-gray-50 text-gray-600"
              }`}>
                {weightChange > 0 ? "+" : ""}{weightChange}kg this period
              </span>
            )}
          </div>
        )}
      </Card>

      {/* Calorie heatmap — shown right after header for 30d view */}
      {range === 30 && profile && (
        <Card title="Logging consistency">
          <CalendarHeatmap
            days={days}
            kcalByDate={Object.fromEntries(
              days.map((d) => [d, Math.round(totalsByDate.get(d)?.kcal ?? 0)])
            )}
            kcalTarget={profile.kcalTarget}
          />
        </Card>
      )}

      {/* Nutrition trends */}
      <Card title="Nutrition">
        <div className="grid gap-2 md:grid-cols-3 mb-4">
          <div className="rounded-xl bg-surface-muted p-3">
            <div className="text-xs text-gray-500">Avg calories</div>
            <div className="mt-1 text-lg font-semibold tabular-nums">{avgNutrition.kcal} kcal</div>
          </div>
          <div className="rounded-xl bg-surface-muted p-3">
            <div className="text-xs text-gray-500">Avg protein</div>
            <div className="mt-1 text-lg font-semibold tabular-nums">{avgNutrition.protein} g</div>
          </div>
          <div className="rounded-xl bg-surface-muted p-3">
            <div className="text-xs text-gray-500">Avg fiber</div>
            <div className="mt-1 text-lg font-semibold tabular-nums">{avgNutrition.fiber} g</div>
          </div>
        </div>
        <NutritionChart data={nutritionData} kcalTarget={profile?.kcalTarget} />
      </Card>

      {/* Workout trends */}
      <Card title="Training">
        <div className="grid gap-2 md:grid-cols-3 mb-4">
          <div className="rounded-xl bg-surface-muted p-3">
            <div className="text-xs text-gray-500">Avg cal burned</div>
            <div className="mt-1 text-lg font-semibold tabular-nums">{avgWorkout.burned} kcal</div>
          </div>
          <div className="rounded-xl bg-surface-muted p-3">
            <div className="text-xs text-gray-500">Avg volume</div>
            <div className="mt-1 text-lg font-semibold tabular-nums">{avgWorkout.volume} kg</div>
          </div>
          <div className="rounded-xl bg-surface-muted p-3">
            <div className="text-xs text-gray-500">Active days</div>
            <div className="mt-1 text-lg font-semibold tabular-nums">{avgWorkout.activeDays} / {range}</div>
          </div>
        </div>
        <WorkoutChart data={workoutData} />
      </Card>

      {/* Weight trend */}
      {weightData.length > 0 && (
        <Card title="Body Weight">
          <div className="grid gap-2 md:grid-cols-3 mb-4">
            <div className="rounded-xl bg-surface-muted p-3">
              <div className="text-xs text-gray-500">Current</div>
              <div className="mt-1 text-lg font-semibold tabular-nums">
                {weightData[weightData.length - 1].weightKg} kg
              </div>
            </div>
            {weightData.length >= 2 && (
              <div className="rounded-xl bg-surface-muted p-3">
                <div className="text-xs text-gray-500">First recorded</div>
                <div className="mt-1 text-lg font-semibold tabular-nums">
                  {weightData[0].weightKg} kg
                </div>
              </div>
            )}
            {weightChange !== null && (
              <div className="rounded-xl bg-surface-muted p-3">
                <div className="text-xs text-gray-500">Change</div>
                <div className={`mt-1 text-lg font-semibold tabular-nums ${
                  weightChange < 0 ? "text-green-600" : weightChange > 0 ? "text-amber-600" : "text-gray-600"
                }`}>
                  {weightChange > 0 ? "+" : ""}{weightChange} kg
                </div>
              </div>
            )}
          </div>
          <WeightChart data={weightData} />
        </Card>
      )}

      {/* AI Weekly Summary (7d view) */}
      {range === 7 && hasGoals && (
        <Card title="Your week in review">
          <WeeklySummary
            days={days.map((d) => {
              const t = totalsByDate.get(d) ?? empty();
              return {
                date: d,
                kcal: Math.round(t.kcal),
                protein: toFixed1(t.protein_g),
                carbs: toFixed1(t.carbs_g),
                fat: toFixed1(t.fat_g),
                fiber: toFixed1(t.fiber_g ?? 0),
              };
            })}
            targets={{
              kcal: profile!.kcalTarget,
              protein: profile!.proteinTarget,
              carbs: profile!.carbsTarget,
              fat: profile!.fatTarget,
              fiber: profile!.fiberTarget,
            }}
            workoutDays={avgWorkout.activeDays}
            totalBurned={workoutSum.burned}
            weightChange={weightChange}
          />
        </Card>
      )}

      {/* Weekly summary (for 30d view) */}
      {range === 30 && (
        <Card title="Weekly breakdown">
          <div className="space-y-3">
            {[0, 1, 2, 3].map((weekIdx) => {
              const weekDays = days.slice(weekIdx * 7, (weekIdx + 1) * 7);
              if (weekDays.length === 0) return null;

              const weekLoggedDays = weekDays.filter((d) => totalsByDate.has(d)).length || 1;
              const weekNutrition = weekDays.reduce(
                (acc, d) => {
                  const t = totalsByDate.get(d);
                  if (!t) return acc;
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
                <div key={weekIdx} className="rounded-xl bg-surface-muted p-3">
                  <div className="text-xs font-medium text-gray-500 mb-1.5">{weekLabel}</div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm tabular-nums sm:grid-cols-3">
                    <span>{Math.round(weekNutrition.kcal / weekLoggedDays)} kcal/day</span>
                    <span>{toFixed1(weekNutrition.protein / weekLoggedDays)}g protein/day</span>
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
