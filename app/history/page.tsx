import { Card } from "@/components/Card";
import { LogEntryCard } from "@/components/LogEntryCard";
import { LogMealTabs } from "@/components/LogMealTabs";
import { LogWorkoutTabs } from "@/components/LogWorkoutTabs";
import { prisma } from "@/lib/db";
import { addNutrients, round0, round1, safeNutrientsForEntry, type Nutrients } from "@/lib/nutrition";
import {
  applyEstimatedMeal,
  applyEstimatedDay,
  createManualFoodAndLogEntry,
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

function formatDateLabel(date: string): string {
  const d = new Date(date + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
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

  const hasData = entries.length > 0 || workouts.length > 0;

  return (
    <div className="space-y-4">
      {/* Date nav */}
      <Card>
        <div className="flex items-center justify-between gap-4">
          <Link href={`/history?date=${prevDate(date)}`}
            className="rounded-xl bg-surface-muted px-3 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-200 transition-colors">
            ←
          </Link>
          <div className="text-center">
            <div className="text-lg font-bold">{formatDateLabel(date)}</div>
            <div className="text-xs text-gray-400 tabular-nums">{date}</div>
            {isToday && <div className="text-xs text-brand-600 font-medium mt-0.5">Today</div>}
          </div>
          <Link href={isToday ? "/history" : `/history?date=${nextDate(date)}`}
            className={`rounded-xl bg-surface-muted px-3 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-200 transition-colors ${isToday ? "opacity-30 pointer-events-none" : ""}`}>
            →
          </Link>
        </div>

        {/* Day recap summary */}
        {hasData && (() => {
          const kcalTgt = profile?.kcalTarget ?? null;
          const kcalDiff = kcalTgt !== null ? kcalTgt - Number(dayTotals.kcal) : null;
          return (
            <div className="mt-4">
              <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-2">Day recap</div>
              <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
                {[
                  { label: "Calories", value: round0(dayTotals.kcal), color: "text-gray-900" },
                  { label: "Protein", value: `${round1(dayTotals.protein_g)}g`, color: "text-blue-600" },
                  { label: "Carbs", value: `${round1(dayTotals.carbs_g)}g`, color: "text-amber-600" },
                  { label: "Fat", value: `${round1(dayTotals.fat_g)}g`, color: "text-rose-500" },
                  { label: "Fiber", value: `${round1(dayTotals.fiber_g ?? 0)}g`, color: "text-green-600" },
                  { label: "Burned", value: round0(totalBurned), color: "text-blue-600" },
                ].map(({ label, value, color }) => (
                  <div key={label} className="text-center rounded-xl bg-surface-muted px-2 py-2.5">
                    <div className={`text-sm font-bold tabular-nums ${color}`}>{value}</div>
                    <div className="text-[10px] text-gray-400 mt-0.5">{label}</div>
                  </div>
                ))}
              </div>
              {kcalDiff !== null && (
                <div className="mt-2 text-xs text-center">
                  {kcalDiff >= 0
                    ? <span className="text-gray-400 tabular-nums">{round0(kcalDiff)} kcal under target</span>
                    : <span className="text-red-500 font-medium tabular-nums">{round0(-kcalDiff)} kcal over target</span>
                  }
                </div>
              )}
            </div>
          );
        })()}
      </Card>

      {/* Add meal for this date */}
      <Card variant="action" title="Log a meal">
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
          showCoach={false}
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
                const macroLine = [
                  `${round1(e.amount)} ${e.unit === "GRAM" ? "g" : "serving"}`,
                  n ? `${round0(n.kcal)} cal · ${round1(n.protein_g)}P ${round1(n.carbs_g)}C ${round1(n.fat_g)}F` : "",
                ].filter(Boolean).join(" · ");
                return (
                  <LogEntryCard
                    key={e.id}
                    entryId={e.id}
                    foodName={e.food.name}
                    brand={e.food.brand}
                    amount={e.amount}
                    unit={e.unit}
                    mealType={e.mealType}
                    macroLine={macroLine}
                  />
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
              <div key={e.id} className="flex items-center justify-between gap-3 rounded-xl bg-surface-muted p-3">
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

      {!hasData && (
        <div className="rounded-2xl border-2 border-dashed border-gray-200 py-10 text-center">
          <div className="text-4xl mb-3">{isToday ? "🍽️" : "📅"}</div>
          <div className="text-sm font-bold text-gray-600">
            {isToday ? "Nothing logged yet today" : "Rest day"}
          </div>
          <div className="text-xs text-gray-400 mt-1">
            {isToday
              ? "Use the forms above to log a meal or workout"
              : "No meals or workouts were logged on this day"}
          </div>
        </div>
      )}
    </div>
  );
}
