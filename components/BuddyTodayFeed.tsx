import { getBuddyId, getBuddyEntriesForDate, getBuddyInfo } from "@/lib/buddy";
import { Card } from "@/components/Card";
import { ReactionBar } from "@/components/ReactionBar";
import { addNutrients, round0, round1, safeNutrientsForEntry, type Nutrients } from "@/lib/nutrition";

function emptyTotals(): Nutrients {
  return { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, sodium_mg: 0 };
}

const MEAL_LABELS: Record<string, string> = {
  BREAKFAST: "🌅 Breakfast",
  LUNCH: "☀️ Lunch",
  DINNER: "🌙 Dinner",
  SNACK: "🍎 Snacks",
  CUSTOM: "✨ Custom",
};

export async function BuddyTodayFeed({
  currentUserId,
  date,
}: {
  currentUserId: string;
  date: string;
}) {
  const buddyId = await getBuddyId(currentUserId);

  if (!buddyId) {
    return (
      <Card title="🤝 Buddy">
        <p className="text-sm text-slate-500">
          No buddy yet. Go to the <a href="/buddy" className="underline text-slate-700">Buddy page</a> to add one!
        </p>
      </Card>
    );
  }

  const [buddy, entries] = await Promise.all([
    getBuddyInfo(buddyId),
    getBuddyEntriesForDate(buddyId, date),
  ]);

  const dayTotals = entries.reduce((acc, e) => {
    const n = safeNutrientsForEntry(e, e.food);
    return n ? addNutrients(acc, n) : acc;
  }, emptyTotals());

  const byMeal = new Map<string, typeof entries>();
  for (const e of entries) {
    const arr = byMeal.get(e.mealType) ?? [];
    arr.push(e);
    byMeal.set(e.mealType, arr);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-base font-semibold">🤝 {buddy?.username ?? "Buddy"}'s Today</span>
        <span className="text-xs text-slate-400">React to motivate them!</span>
      </div>

      {entries.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-500">Your buddy hasn't logged anything yet today.</p>
        </Card>
      ) : (
        <>
          <Card>
            <div className="text-xs text-slate-500 mb-2">Daily total</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 text-sm">
              {[
                { label: "Calories", value: `${round0(dayTotals.kcal)} kcal` },
                { label: "Protein", value: `${round1(dayTotals.protein_g)}g` },
                { label: "Carbs", value: `${round1(dayTotals.carbs_g)}g` },
                { label: "Fat", value: `${round1(dayTotals.fat_g)}g` },
                { label: "Fiber", value: `${round1(dayTotals.fiber_g ?? 0)}g` },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="text-xs text-slate-500">{label}</div>
                  <div className="font-medium tabular-nums">{value}</div>
                </div>
              ))}
            </div>
          </Card>

          {Array.from(byMeal.entries()).map(([mealKey, mealEntries]) => {
            const mealTotals = mealEntries.reduce((acc, e) => {
              const n = safeNutrientsForEntry(e, e.food);
              return n ? addNutrients(acc, n) : acc;
            }, emptyTotals());

            return (
              <Card
                key={mealKey}
                title={`${MEAL_LABELS[mealKey] ?? mealKey} · ${round0(mealTotals.kcal)} kcal`}
              >
                <div className="space-y-3">
                  {mealEntries.map((e) => {
                    const n = safeNutrientsForEntry(e, e.food);
                    return (
                      <div key={e.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <div className="text-sm font-medium">
                              {e.food.name}
                              {e.food.brand && (
                                <span className="font-normal text-slate-400"> ({e.food.brand})</span>
                              )}
                            </div>
                            <div className="text-xs text-slate-500">
                              {round1(e.amount)} {e.unit === "GRAM" ? "g" : "serving"}
                              {e.isEstimated ? " · estimated" : ""}
                            </div>
                          </div>
                          <div className="text-xs text-slate-500 tabular-nums">
                            {n ? `${round0(n.kcal)} kcal · ${round1(n.protein_g)}P / ${round1(n.carbs_g)}C / ${round1(n.fat_g)}F` : "—"}
                          </div>
                        </div>
                        <ReactionBar
                          logEntryId={e.id}
                          currentUserId={currentUserId}
                          reactions={e.reactions as Parameters<typeof ReactionBar>[0]["reactions"]}
                        />
                      </div>
                    );
                  })}
                </div>
              </Card>
            );
          })}
        </>
      )}
    </div>
  );
}
