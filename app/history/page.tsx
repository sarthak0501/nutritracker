import { Card } from "@/components/Card";
import { LogMealTabs } from "@/components/LogMealTabs";
import { LogWorkoutTabs } from "@/components/LogWorkoutTabs";
import { prisma } from "@/lib/db";
import { addNutrients, round0, round1, safeNutrientsForEntry, type Nutrients } from "@/lib/nutrition";
import {
  applyEstimatedMeal,
  applyEstimatedDay,
  createManualFoodAndLogEntry,
  deleteLogEntry,
} from "@/app/actions/logging";
import {
  applyEstimatedWorkout,
  createManualWorkoutEntry,
  deleteWorkoutEntry,
  addRecommendedExercise,
  addAllRecommendedExercises,
} from "@/app/actions/workout";
import { requireSession } from "@/lib/session";
import { todayIsoDate } from "@/lib/dates";
import Link from "next/link";

function emptyTotals(): Nutrients {
  return { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, sodium_mg: 0 };
}

function prevDate(date: string) {
  const d = new Date(date + "T00:00:00");
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function nextDate(date: string) {
  const d = new Date(date + "T00:00:00");
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

const MEAL_LABELS: Record<string, string> = {
  BREAKFAST: "🌅 Breakfast",
  LUNCH: "☀️ Lunch",
  DINNER: "🌙 Dinner",
  SNACK: "🍎 Snacks",
  CUSTOM: "✨ Custom",
};

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const user = await requireSession();
  const params = await searchParams;
  const today = todayIsoDate();
  const date = params.date ?? today;
  const isToday = date === today;

  const [entries, workouts, profile] = await Promise.all([
    prisma.logEntry.findMany({
      where: { userId: user.id, date },
      include: { food: true },
      orderBy: [{ mealType: "asc" }, { createdAt: "asc" }],
    }),
    prisma.workoutEntry.findMany({
      where: { userId: user.id, date },
      orderBy: { createdAt: "asc" },
    }),
    prisma.profile.findUnique({ where: { userId: user.id } }),
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

  // Profile data for workout recommendations
  const profileData = {
    equipmentPreset: profile?.equipmentPreset ?? undefined,
    equipment: profile?.equipment ?? undefined,
    weightKg: profile?.weightKg ?? undefined,
    heightCm: profile?.heightCm ?? undefined,
    age: profile?.age ?? undefined,
    gender: profile?.gender ?? undefined,
  };

  // Previous workout data for autofill
  const previousRaw = await prisma.workoutEntry.findMany({
    where: { userId: user.id, date: { not: date } },
    orderBy: { createdAt: "desc" },
    select: { exerciseName: true, sets: true, reps: true, weightKg: true, date: true },
  });
  const previousMap = new Map<string, typeof previousRaw[number]>();
  for (const p of previousRaw) {
    const key = p.exerciseName.toLowerCase();
    if (!previousMap.has(key)) previousMap.set(key, p);
  }
  const previousWorkouts = Array.from(previousMap.values());

  return (
    <div className="space-y-4">
      {/* Date nav */}
      <Card>
        <div className="flex items-center justify-between gap-4">
          <Link href={`/history?date=${prevDate(date)}`}
            className="rounded-xl bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-200 transition-colors">←</Link>
          <div className="text-center">
            <div className="text-lg font-bold">{date}</div>
            {isToday && <div className="text-xs text-brand-600 font-medium">Today</div>}
          </div>
          <Link href={isToday ? "/history" : `/history?date=${nextDate(date)}`}
            className={`rounded-xl bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-200 transition-colors ${isToday ? "opacity-30 pointer-events-none" : ""}`}>
            →
          </Link>
        </div>
        {(entries.length > 0 || workouts.length > 0) && (() => {
          const kcalTgt = profile?.kcalTarget ?? null;
          const kcalDiff = kcalTgt !== null ? kcalTgt - Number(dayTotals.kcal) : null;
          const proteinTgt = profile?.proteinTarget ?? null;
          const proteinDiff = proteinTgt !== null ? proteinTgt - Number(dayTotals.protein_g) : null;
          const carbsTgt = profile?.carbsTarget ?? null;
          const carbsDiff = carbsTgt !== null ? carbsTgt - Number(dayTotals.carbs_g) : null;
          const fatTgt = profile?.fatTarget ?? null;
          const fatDiff = fatTgt !== null ? fatTgt - Number(dayTotals.fat_g) : null;
          const fiberTgt = profile?.fiberTarget ?? null;
          const fiberDiff = fiberTgt !== null ? fiberTgt - Number(dayTotals.fiber_g ?? 0) : null;
          const statsItems = [
            {
              label: "Calories",
              value: round0(dayTotals.kcal),
              sub: kcalDiff !== null ? (kcalDiff >= 0 ? `${round0(kcalDiff)} left` : `+${round0(-kcalDiff)} over`) : null,
              color: kcalDiff === null ? "text-gray-900" : kcalDiff >= 0 ? "text-green-600" : "text-red-500",
              subColor: kcalDiff === null ? "text-gray-400" : kcalDiff >= 0 ? "text-gray-400" : "text-red-400",
            },
            {
              label: "Protein",
              value: `${round1(dayTotals.protein_g)}g`,
              sub: proteinDiff !== null ? (proteinDiff <= 0 ? "✓" : `${round1(proteinDiff)}g left`) : null,
              color: proteinDiff === null ? "text-blue-600" : proteinDiff <= 0 ? "text-green-600" : "text-orange-500",
              subColor: proteinDiff === null ? "text-gray-400" : proteinDiff <= 0 ? "text-green-500" : "text-orange-400",
            },
            {
              label: "Carbs",
              value: `${round1(dayTotals.carbs_g)}g`,
              sub: carbsDiff !== null ? (carbsDiff >= 0 ? `${round1(carbsDiff)}g left` : `+${round1(-carbsDiff)}g over`) : null,
              color: carbsDiff === null ? "text-amber-600" : carbsDiff >= 0 ? "text-green-600" : "text-red-500",
              subColor: carbsDiff === null ? "text-gray-400" : carbsDiff >= 0 ? "text-gray-400" : "text-red-400",
            },
            {
              label: "Fat",
              value: `${round1(dayTotals.fat_g)}g`,
              sub: fatDiff !== null ? (fatDiff >= 0 ? `${round1(fatDiff)}g left` : `+${round1(-fatDiff)}g over`) : null,
              color: fatDiff === null ? "text-rose-500" : fatDiff >= 0 ? "text-green-600" : "text-red-500",
              subColor: fatDiff === null ? "text-gray-400" : fatDiff >= 0 ? "text-gray-400" : "text-red-400",
            },
            {
              label: "Fiber",
              value: `${round1(dayTotals.fiber_g ?? 0)}g`,
              sub: fiberDiff !== null ? (fiberDiff <= 0 ? "✓" : `${round1(fiberDiff)}g left`) : null,
              color: fiberDiff === null ? "text-green-600" : fiberDiff <= 0 ? "text-green-600" : "text-orange-500",
              subColor: fiberDiff === null ? "text-gray-400" : fiberDiff <= 0 ? "text-green-500" : "text-orange-400",
            },
            { label: "Burned", value: round0(totalBurned), sub: null, color: "text-blue-600", subColor: "text-gray-400" },
          ];
          return (
            <div className="mt-4 grid grid-cols-3 gap-2 md:grid-cols-6">
              {statsItems.map(({ label, value, sub, color, subColor }) => (
                <div key={label} className="text-center rounded-xl bg-gray-50 px-2 py-2.5">
                  <div className={`text-sm font-bold tabular-nums ${color}`}>{value}</div>
                  <div className="text-[10px] text-gray-400 mt-0.5">{label}</div>
                  {sub && <div className={`text-[9px] font-medium tabular-nums mt-0.5 ${subColor}`}>{sub}</div>}
                </div>
              ))}
            </div>
          );
        })()}
      </Card>

      {/* Add meal for this date */}
      <Card title="Log a meal">
        <LogMealTabs
          date={date}
          onApplyEstimate={applyEstimatedMeal}
          onApplyDay={applyEstimatedDay}
          manualAction={createManualFoodAndLogEntry}
        />
      </Card>

      {/* Add workout for this date */}
      <Card title="Log a workout">
        <LogWorkoutTabs
          date={date}
          weightKg={profileData.weightKg}
          profile={profileData}
          previousWorkouts={previousWorkouts}
          onApplyEstimate={applyEstimatedWorkout}
          manualAction={createManualWorkoutEntry}
          onAddRecommended={addRecommendedExercise}
          onAddAllRecommended={addAllRecommendedExercises}
        />
      </Card>

      {/* Logged meals */}
      {Array.from(byMeal.entries()).map(([mealKey, mealEntries]) => {
        const mealTotals = mealEntries.reduce((acc, e) => {
          const n = safeNutrientsForEntry(e, e.food);
          return n ? addNutrients(acc, n) : acc;
        }, emptyTotals());

        return (
          <Card key={mealKey}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-bold text-gray-800">{MEAL_LABELS[mealKey] ?? mealKey}</span>
              <span className="text-sm font-semibold tabular-nums text-brand-600">{round0(mealTotals.kcal)} kcal</span>
            </div>
            <div className="space-y-2">
              {mealEntries.map((e) => {
                const n = safeNutrientsForEntry(e, e.food);
                return (
                  <div key={e.id} className="flex items-center justify-between gap-3 rounded-xl bg-gray-50 p-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-gray-800">
                        {e.food.name}
                        {e.food.brand && <span className="font-normal text-gray-400"> ({e.food.brand})</span>}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {round1(e.amount)} {e.unit === "GRAM" ? "g" : "serving"}
                        {n ? <> · {round0(n.kcal)} cal · {round1(n.protein_g)}P {round1(n.carbs_g)}C {round1(n.fat_g)}F</> : ""}
                      </div>
                    </div>
                    <form action={deleteLogEntry}>
                      <input type="hidden" name="id" value={e.id} />
                      <button className="rounded-lg p-1.5 text-gray-300 hover:bg-red-50 hover:text-red-400 transition-colors">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </form>
                  </div>
                );
              })}
            </div>
          </Card>
        );
      })}

      {/* Logged workouts */}
      {workouts.length > 0 && (
        <Card>
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-bold text-gray-800">💪 Workouts</span>
            <span className="text-sm font-semibold tabular-nums text-blue-600">{round0(totalBurned)} kcal</span>
          </div>
          <div className="space-y-2">
            {workouts.map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-3 rounded-xl bg-gray-50 p-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-gray-800">{e.exerciseName}</div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {e.muscleGroup && <span className="capitalize">{e.muscleGroup} · </span>}
                    {e.durationMinutes && <span>{e.durationMinutes} min · </span>}
                    {e.sets && e.reps && <span>{e.sets}×{e.reps} · </span>}
                    {e.weightKg && <span>{e.weightKg}kg · </span>}
                    ~{round0(e.caloriesBurned)} kcal
                  </div>
                </div>
                <form action={deleteWorkoutEntry}>
                  <input type="hidden" name="id" value={e.id} />
                  <button className="rounded-lg p-1.5 text-gray-300 hover:bg-red-50 hover:text-red-400 transition-colors">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </form>
              </div>
            ))}
          </div>
        </Card>
      )}

      {entries.length === 0 && workouts.length === 0 && (
        <div className="text-center py-4 text-sm text-gray-400">No entries yet for this day. Use the forms above to add data.</div>
      )}
    </div>
  );
}
