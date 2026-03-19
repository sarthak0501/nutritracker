import { Card } from "@/components/Card";
import { prisma } from "@/lib/db";
import { addNutrients, round0, round1, safeNutrientsForEntry, type Nutrients } from "@/lib/nutrition";
import { deleteLogEntry } from "@/app/actions/logging";
import { requireSession } from "@/lib/session";
import Link from "next/link";

function emptyTotals(): Nutrients {
  return { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, sodium_mg: 0 };
}

function NutrientPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/30 px-3 py-2 text-sm">
      <div className="text-xs text-zinc-400">{label}</div>
      <div className="font-medium tabular-nums">{value}</div>
    </div>
  );
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
  BREAKFAST: "Breakfast",
  LUNCH: "Lunch",
  DINNER: "Dinner",
  SNACK: "Snacks",
  CUSTOM: "Custom",
};

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const user = await requireSession();
  const params = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const date = params.date ?? today;
  const isToday = date === today;

  const entries = await prisma.logEntry.findMany({
    where: { userId: user.id, date },
    include: { food: true },
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

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between gap-4">
          <Link href={`/history?date=${prevDate(date)}`}
            className="rounded-lg border border-zinc-800 px-3 py-2 text-sm hover:bg-zinc-900">← Prev</Link>
          <div className="text-center">
            <div className="text-lg font-semibold">{date}</div>
            {isToday && <div className="text-xs text-zinc-400">Today</div>}
          </div>
          <Link href={isToday ? "/history" : `/history?date=${nextDate(date)}`}
            className={`rounded-lg border border-zinc-800 px-3 py-2 text-sm hover:bg-zinc-900 ${isToday ? "opacity-30 pointer-events-none" : ""}`}>
            Next →
          </Link>
        </div>
        {entries.length > 0 && (
          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5">
            <NutrientPill label="Calories" value={`${round0(dayTotals.kcal)} kcal`} />
            <NutrientPill label="Protein" value={`${round1(dayTotals.protein_g)} g`} />
            <NutrientPill label="Carbs" value={`${round1(dayTotals.carbs_g)} g`} />
            <NutrientPill label="Fat" value={`${round1(dayTotals.fat_g)} g`} />
            <NutrientPill label="Fiber" value={`${round1(dayTotals.fiber_g ?? 0)} g`} />
          </div>
        )}
      </Card>

      {entries.length === 0 ? (
        <Card>
          <div className="text-sm text-zinc-400">No meals logged for this day.</div>
        </Card>
      ) : (
        Array.from(byMeal.entries()).map(([mealKey, mealEntries]) => {
          const mealTotals = mealEntries.reduce((acc, e) => {
            const n = safeNutrientsForEntry(e, e.food);
            return n ? addNutrients(acc, n) : acc;
          }, emptyTotals());

          return (
            <Card key={mealKey} title={`${MEAL_LABELS[mealKey] ?? mealKey} · ${round0(mealTotals.kcal)} kcal`}>
              <div className="space-y-2">
                {mealEntries.map((e) => {
                  const n = safeNutrientsForEntry(e, e.food);
                  return (
                    <div key={e.id} className="flex flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-950/20 p-3 md:flex-row md:items-center md:justify-between">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          {e.food.name}
                          {e.food.brand && <span className="font-normal text-zinc-400"> ({e.food.brand})</span>}
                        </div>
                        <div className="text-xs text-zinc-400">
                          {round1(e.amount)} {e.unit === "GRAM" ? "g" : "serving"}{e.isEstimated ? " · estimated" : ""}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-xs text-zinc-400 tabular-nums">
                          {n ? <>{round0(n.kcal)} kcal · {round1(n.protein_g)}P / {round1(n.carbs_g)}C / {round1(n.fat_g)}F</> : "—"}
                        </div>
                        <form action={deleteLogEntry}>
                          <input type="hidden" name="id" value={e.id} />
                          <button className="rounded-lg border border-zinc-800 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-900">Delete</button>
                        </form>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          );
        })
      )}
    </div>
  );
}
