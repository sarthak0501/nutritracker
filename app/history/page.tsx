import { Card } from "@/components/Card";
import { prisma } from "@/lib/db";
import { addNutrients, round0, round1, safeNutrientsForEntry, type Nutrients } from "@/lib/nutrition";
import { deleteLogEntry } from "@/app/actions/logging";
import { deleteWorkoutEntry } from "@/app/actions/workout";
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

  const [entries, workouts] = await Promise.all([
    prisma.logEntry.findMany({
      where: { userId: user.id, date },
      include: { food: true },
      orderBy: [{ mealType: "asc" }, { createdAt: "asc" }],
    }),
    prisma.workoutEntry.findMany({
      where: { userId: user.id, date },
      orderBy: { createdAt: "asc" },
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

  return (
    <div className="space-y-4">
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
        {(entries.length > 0 || workouts.length > 0) && (
          <div className="mt-4 grid grid-cols-3 gap-2 md:grid-cols-5">
            {[
              { label: "Calories", value: `${round0(dayTotals.kcal)}`, color: "text-gray-900" },
              { label: "Protein", value: `${round1(dayTotals.protein_g)}g`, color: "text-blue-600" },
              { label: "Carbs", value: `${round1(dayTotals.carbs_g)}g`, color: "text-amber-600" },
              { label: "Fat", value: `${round1(dayTotals.fat_g)}g`, color: "text-rose-500" },
              { label: "Burned", value: `${round0(totalBurned)}`, color: "text-blue-600" },
            ].map(({ label, value, color }) => (
              <div key={label} className="text-center rounded-xl bg-gray-50 px-2 py-2.5">
                <div className={`text-sm font-bold tabular-nums ${color}`}>{value}</div>
                <div className="text-[10px] text-gray-400 mt-0.5">{label}</div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {entries.length === 0 && workouts.length === 0 ? (
        <div className="text-center py-8 text-sm text-gray-400">Nothing logged for this day.</div>
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}
