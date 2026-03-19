import { Card } from "@/components/Card";
import { EstimateFromText } from "@/components/EstimateFromText";
import {
  applyEstimatedMeal,
  createLogEntryFromExistingFood,
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

function NutrientPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/30 px-3 py-2 text-sm">
      <div className="text-xs text-zinc-400">{label}</div>
      <div className="font-medium tabular-nums">{value}</div>
    </div>
  );
}

export default async function TodayPage() {
  const user = await requireSession();
  const today = new Date().toISOString().slice(0, 10);

  const profile = await prisma.profile.findUnique({ where: { userId: user.id } });

  const [foods, entries] = await Promise.all([
    prisma.food.findMany({ orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.logEntry.findMany({
      where: { userId: user.id, date: today },
      include: { food: true, reactions: { include: { user: { select: { id: true, username: true } } } } },
      orderBy: [{ mealType: "asc" }, { createdAt: "asc" }],
    }),
  ]);

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

  const remaining = profile
    ? {
        kcal: profile.kcalTarget - dayTotals.kcal,
        protein_g: profile.proteinTarget - dayTotals.protein_g,
        carbs_g: profile.carbsTarget - dayTotals.carbs_g,
        fat_g: profile.fatTarget - dayTotals.fat_g,
        fiber_g: (profile.fiberTarget ?? 0) - (dayTotals.fiber_g ?? 0),
      }
    : null;

  return (
    <div className="space-y-4">
      {/* Daily summary */}
      <Card>
        <div className="text-sm text-zinc-400">Today · {user.name}</div>
        <div className="text-lg font-semibold">{today}</div>
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5">
          <NutrientPill label="Calories" value={`${round0(dayTotals.kcal)} kcal`} />
          <NutrientPill label="Protein" value={`${round1(dayTotals.protein_g)} g`} />
          <NutrientPill label="Carbs" value={`${round1(dayTotals.carbs_g)} g`} />
          <NutrientPill label="Fat" value={`${round1(dayTotals.fat_g)} g`} />
          <NutrientPill label="Fiber" value={`${round1(dayTotals.fiber_g ?? 0)} g`} />
        </div>
        {remaining && (
          <div className="mt-3 text-xs text-zinc-400">
            Remaining:{" "}
            <span className="tabular-nums">
              {round0(remaining.kcal)} kcal · {round1(remaining.protein_g)}P / {round1(remaining.carbs_g)}C / {round1(remaining.fat_g)}F · {round1(remaining.fiber_g ?? 0)}g fiber
            </span>
          </div>
        )}
      </Card>

      {/* Log forms */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Estimate from text (LLM)">
          <EstimateFromText date={today} onApply={applyEstimatedMeal} />
          <div className="mt-2 text-xs text-zinc-400">
            Uses AI to estimate nutrition from a description. Enable with <span className="font-mono">LLM_ENABLED=true</span>.
          </div>
        </Card>

        <Card title="Add existing food">
          <form action={createLogEntryFromExistingFood} className="grid gap-3">
            <input type="hidden" name="date" value={today} />
            <div className="grid gap-2 md:grid-cols-2">
              <label className="grid gap-1 text-sm">
                <div className="text-xs text-zinc-400">Meal</div>
                <select name="mealType" className="rounded-lg border border-zinc-800 bg-zinc-950/30 px-3 py-2">
                  {MEALS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                  <option value="CUSTOM">Custom</option>
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                <div className="text-xs text-zinc-400">Custom name (optional)</div>
                <input name="mealName" placeholder="e.g., Pre-workout" className="rounded-lg border border-zinc-800 bg-zinc-950/30 px-3 py-2" />
              </label>
            </div>
            <label className="grid gap-1 text-sm">
              <div className="text-xs text-zinc-400">Food</div>
              <select name="foodId" className="rounded-lg border border-zinc-800 bg-zinc-950/30 px-3 py-2">
                {foods.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}{f.brand ? ` (${f.brand})` : ""}</option>
                ))}
              </select>
            </label>
            <div className="grid gap-2 grid-cols-3">
              <label className="grid gap-1 text-sm col-span-1">
                <div className="text-xs text-zinc-400">Amount</div>
                <input name="amount" type="number" inputMode="decimal" step="0.1" defaultValue={100} className="rounded-lg border border-zinc-800 bg-zinc-950/30 px-3 py-2" />
              </label>
              <label className="grid gap-1 text-sm col-span-1">
                <div className="text-xs text-zinc-400">Unit</div>
                <select name="unit" className="rounded-lg border border-zinc-800 bg-zinc-950/30 px-3 py-2">
                  <option value="GRAM">grams</option>
                  <option value="SERVING">serving</option>
                </select>
              </label>
              <div className="flex items-end col-span-1">
                <button className="w-full rounded-lg bg-zinc-50 px-3 py-2 text-sm font-medium text-zinc-950 hover:bg-white">Add</button>
              </div>
            </div>
          </form>
        </Card>

        <Card title="Quick add (manual nutrition)">
          <form action={createManualFoodAndLogEntry} className="grid gap-3">
            <input type="hidden" name="date" value={today} />
            <div className="grid gap-2 md:grid-cols-2">
              <label className="grid gap-1 text-sm">
                <div className="text-xs text-zinc-400">Meal</div>
                <select name="mealType" className="rounded-lg border border-zinc-800 bg-zinc-950/30 px-3 py-2">
                  {MEALS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                  <option value="CUSTOM">Custom</option>
                </select>
              </label>
              <label className="grid gap-1 text-sm">
                <div className="text-xs text-zinc-400">Custom name (optional)</div>
                <input name="mealName" placeholder="e.g., Late-night" className="rounded-lg border border-zinc-800 bg-zinc-950/30 px-3 py-2" />
              </label>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <label className="grid gap-1 text-sm">
                <div className="text-xs text-zinc-400">Food name</div>
                <input name="name" placeholder="e.g., Greek yogurt" className="rounded-lg border border-zinc-800 bg-zinc-950/30 px-3 py-2" />
              </label>
              <label className="grid gap-1 text-sm">
                <div className="text-xs text-zinc-400">Brand (optional)</div>
                <input name="brand" placeholder="e.g., Chobani" className="rounded-lg border border-zinc-800 bg-zinc-950/30 px-3 py-2" />
              </label>
            </div>
            <div className="grid gap-2 grid-cols-3">
              <label className="grid gap-1 text-sm">
                <div className="text-xs text-zinc-400">Amount</div>
                <input name="amount" type="number" inputMode="decimal" step="0.1" defaultValue={100} className="rounded-lg border border-zinc-800 bg-zinc-950/30 px-3 py-2" />
              </label>
              <label className="grid gap-1 text-sm">
                <div className="text-xs text-zinc-400">Unit</div>
                <select name="unit" className="rounded-lg border border-zinc-800 bg-zinc-950/30 px-3 py-2">
                  <option value="GRAM">grams</option>
                  <option value="SERVING">serving</option>
                </select>
              </label>
              <div className="flex items-end">
                <button className="w-full rounded-lg bg-zinc-50 px-3 py-2 text-sm font-medium text-zinc-950 hover:bg-white">Add</button>
              </div>
            </div>
            <div className="grid gap-2 grid-cols-2 md:grid-cols-3">
              {[
                { name: "kcalPer100g", label: "kcal/100g" },
                { name: "proteinPer100g", label: "protein g/100g" },
                { name: "carbsPer100g", label: "carbs g/100g" },
                { name: "fatPer100g", label: "fat g/100g" },
                { name: "fiberPer100g", label: "fiber g/100g (opt)" },
                { name: "sodiumMgPer100g", label: "sodium mg/100g (opt)" },
              ].map(({ name, label }) => (
                <label key={name} className="grid gap-1 text-sm">
                  <div className="text-xs text-zinc-400">{label}</div>
                  <input name={name} type="number" inputMode="decimal" step="0.1" className="rounded-lg border border-zinc-800 bg-zinc-950/30 px-3 py-2" />
                </label>
              ))}
            </div>
          </form>
        </Card>
      </div>

      {/* My meals */}
      <div className="grid gap-4">
        {MEALS.map((m) => {
          const mealEntries = byMeal.get(m.key) ?? [];
          const mealTotals = mealEntries.reduce((acc, e) => {
            const n = safeNutrientsForEntry(e, e.food);
            return n ? addNutrients(acc, n) : acc;
          }, emptyTotals());

          return (
            <Card key={m.key} title={`${m.label} · ${round0(mealTotals.kcal)} kcal`}>
              {mealEntries.length ? (
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
              ) : (
                <div className="text-sm text-zinc-400">No entries yet.</div>
              )}
            </Card>
          );
        })}
      </div>

      {/* Buddy feed */}
      <div className="border-t border-zinc-800 pt-4">
        <BuddyTodayFeed currentUserId={user.id} date={today} />
      </div>
    </div>
  );
}
