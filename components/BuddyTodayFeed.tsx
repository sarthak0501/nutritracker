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

function AvatarBadge({ name }: { name: string }) {
  const initial = (name ?? "?")[0].toUpperCase();
  return (
    <div className="flex items-center justify-center w-9 h-9 rounded-full bg-gradient-to-br from-purple-400 to-pink-400 text-white font-bold text-sm shadow-sm">
      {initial}
    </div>
  );
}

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
      <div className="rounded-2xl bg-gradient-to-br from-purple-50 via-white to-pink-50 p-5 shadow-card border border-purple-100">
        <div className="text-center py-4">
          <div className="text-2xl mb-2">👥</div>
          <div className="text-sm font-bold text-gray-700">Find an accountability buddy</div>
          <div className="text-xs text-gray-400 mt-1">Track together, stay motivated</div>
          <a href="/buddy" className="inline-block mt-3 rounded-xl bg-purple-600 px-4 py-2 text-sm font-bold text-white hover:bg-purple-700 transition-colors">
            Add a buddy
          </a>
        </div>
      </div>
    );
  }

  const [buddy, entries] = await Promise.all([
    getBuddyInfo(buddyId),
    getBuddyEntriesForDate(buddyId, date),
  ]);

  const buddyName = buddy?.username ?? "Buddy";

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
      {/* Social header with avatar */}
      <div className="rounded-2xl bg-gradient-to-br from-purple-50 via-white to-pink-50 p-4 shadow-card border border-purple-100">
        <div className="flex items-center gap-3">
          <AvatarBadge name={buddyName} />
          <div>
            <div className="text-sm font-bold text-gray-800">{buddyName}'s Day</div>
            <div className="text-xs text-gray-400">Your accountability buddy</div>
          </div>
        </div>

        {entries.length === 0 ? (
          <div className="mt-3 text-center py-3">
            <div className="text-xs text-gray-400">Your buddy hasn't logged anything yet today. Send them some encouragement!</div>
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
            {[
              { label: "Calories", value: `${round0(dayTotals.kcal)}` },
              { label: "Protein", value: `${round1(dayTotals.protein_g)}g` },
              { label: "Carbs", value: `${round1(dayTotals.carbs_g)}g` },
              { label: "Fat", value: `${round1(dayTotals.fat_g)}g` },
              { label: "Fiber", value: `${round1(dayTotals.fiber_g ?? 0)}g` },
            ].map(({ label, value }) => (
              <div key={label} className="text-center rounded-xl bg-white/70 px-2 py-2">
                <div className="text-sm font-bold tabular-nums">{value}</div>
                <div className="text-[10px] text-gray-400">{label}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {entries.length > 0 && Array.from(byMeal.entries()).map(([mealKey, mealEntries]) => {
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
            <div className="space-y-3">
              {mealEntries.map((e) => {
                const n = safeNutrientsForEntry(e, e.food);
                return (
                  <div key={e.id} className="rounded-xl bg-surface-muted p-3">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="text-sm font-semibold text-gray-800">
                          {e.food.name}
                          {e.food.brand && (
                            <span className="font-normal text-gray-400"> ({e.food.brand})</span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500">
                          {round1(e.amount)} {e.unit === "GRAM" ? "g" : "serving"}
                          {e.isEstimated ? " · estimated" : ""}
                        </div>
                      </div>
                      <div className="text-xs text-gray-500 tabular-nums">
                        {n ? `${round0(n.kcal)} cal · ${round1(n.protein_g)}P ${round1(n.carbs_g)}C ${round1(n.fat_g)}F` : "—"}
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
    </div>
  );
}
