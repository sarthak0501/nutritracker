import { Card } from "@/components/Card";
import { EstimateFromText } from "@/components/EstimateFromText";
import {
  applyEstimatedMeal,
  createManualFoodAndLogEntry,
  deleteLogEntry,
} from "@/app/actions/logging";
import { prisma } from "@/lib/db";
import { addNutrients, round0, round1, safeNutrientsForEntry, type Nutrients } from "@/lib/nutrition";
import { requireSession } from "@/lib/session";
import { BuddyTodayFeed } from "@/components/BuddyTodayFeed";

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
        {profile && (
          <div className="mt-1.5 text-xs text-slate-400 tabular-nums">
            {round0(profile.kcalTarget - dayTotals.kcal)} kcal remaining · {round1(profile.proteinTarget - dayTotals.protein_g)}P / {round1(profile.carbsTarget - dayTotals.carbs_g)}C / {round1(profile.fatTarget - dayTotals.fat_g)}F
          </div>
        )}
      </Card>

      {/* Log a meal — AI text estimator */}
      <Card title="Log a meal">
        <EstimateFromText date={today} onApply={applyEstimatedMeal} />
        <div className="mt-2 text-xs text-slate-400">
          Describe what you ate and AI estimates the macros.
        </div>

        {/* Manual entry — collapsed by default */}
        <details className="mt-4 border-t border-slate-100 pt-3">
          <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600">
            Manual entry
          </summary>
          <form action={createManualFoodAndLogEntry} className="mt-3 grid gap-3">
            <input type="hidden" name="date" value={today} />
            <div className="grid gap-2 grid-cols-2">
              <label className="grid gap-1 text-sm">
                <div className="text-xs text-slate-500">Meal</div>
                <select name="mealType" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900">
                  {MEALS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                  <option value="CUSTOM">Custom</option>
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                <div className="text-xs text-slate-500">Food name</div>
                <input name="name" placeholder="Greek yogurt" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm placeholder-slate-400" />
              </label>
            </div>
            <div className="grid gap-2 grid-cols-3">
              <label className="grid gap-1 text-sm">
                <div className="text-xs text-slate-500">Amount</div>
                <input name="amount" type="number" inputMode="decimal" step="0.1" defaultValue={100} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
              </label>
              <label className="grid gap-1 text-sm">
                <div className="text-xs text-slate-500">kcal/100g</div>
                <input name="kcalPer100g" type="number" inputMode="decimal" step="0.1" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
              </label>
              <label className="grid gap-1 text-sm">
                <div className="text-xs text-slate-500">Protein</div>
                <input name="proteinPer100g" type="number" inputMode="decimal" step="0.1" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
              </label>
            </div>
            <div className="grid gap-2 grid-cols-3">
              <label className="grid gap-1 text-sm">
                <div className="text-xs text-slate-500">Carbs</div>
                <input name="carbsPer100g" type="number" inputMode="decimal" step="0.1" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
              </label>
              <label className="grid gap-1 text-sm">
                <div className="text-xs text-slate-500">Fat</div>
                <input name="fatPer100g" type="number" inputMode="decimal" step="0.1" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
              </label>
              <div className="flex items-end">
                <button className="w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800">Add</button>
              </div>
            </div>
            <input type="hidden" name="unit" value="GRAM" />
          </form>
        </details>
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
                    return (
                      <div key={e.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
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
          No meals logged yet today. Describe what you ate above to get started.
        </div>
      )}

      {/* Buddy feed */}
      <BuddyTodayFeed currentUserId={user.id} date={today} />
    </div>
  );
}
