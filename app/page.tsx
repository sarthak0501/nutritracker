import { Card } from "@/components/Card";
import { LogMealTabs } from "@/components/LogMealTabs";
import { applyEstimatedMeal, applyEstimatedDay, createManualFoodAndLogEntry, deleteLogEntry } from "@/app/actions/logging";
import { requireSession } from "@/lib/session";
import { round0, round1, safeNutrientsForEntry, addNutrients } from "@/lib/nutrition";
import { BuddyTodayFeed } from "@/components/BuddyTodayFeed";
import { todayIsoDate } from "@/lib/dates";
import { gradeColor } from "@/lib/meal-scoring";
import { WaterTracker } from "@/components/WaterTracker";
import { CopyYesterdayMeal } from "@/components/CopyYesterdayMeal";
import { FrequentMeals } from "@/components/FrequentMeals";
import { MealSuggestion } from "@/components/MealSuggestion";
import { getTodayDashboardData, emptyTotals } from "@/lib/dashboard";
import { redirect } from "next/navigation";

export default async function TodayPage() {
  const user = await requireSession();
  const today = todayIsoDate();

  const data = await getTodayDashboardData(user.id, today);

  if (!data.profile?.onboardingCompleted) redirect("/onboarding");

  const {
    profile,
    entries,
    water,
    dayTotals,
    mealsWithEntries,
    copyableMeals,
    frequentMeals,
    yesterday,
    mealGrades,
    totalBurned,
    kcalTarget,
    kcalPct,
    kcalDiff,
    remainingKcal,
    remainingProtein,
    remainingCarbs,
    remainingFat,
  } = data;

  return (
    <div className="space-y-4">
      {/* 1. PRIMARY: AI Composer — the hero */}
      <div className="rounded-2xl bg-gradient-to-br from-brand-50 via-white to-accent-50 p-5 shadow-card border border-brand-100">
        <div className="mb-1 text-lg font-bold text-gray-900">What did you eat today?</div>
        <div className="mb-4 text-xs text-gray-400">Describe a meal or your whole day — I'll estimate and organize it.</div>
        <LogMealTabs
          date={today}
          onApplyEstimate={applyEstimatedMeal}
          onApplyDay={applyEstimatedDay}
          manualAction={createManualFoodAndLogEntry}
        />
      </div>

      {/* 2. SECONDARY: Day summary */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-xs font-medium text-gray-400 uppercase tracking-wide">{today}</div>
            <div className="text-lg font-bold text-gray-900 mt-0.5">Hi, {user.name}</div>
          </div>
          <div className="relative flex items-center justify-center">
            <svg className="w-16 h-16 -rotate-90" viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="15.5" fill="none" stroke="#f3f4f6" strokeWidth="3" />
              <circle
                cx="18" cy="18" r="15.5" fill="none"
                stroke={kcalPct >= 100 ? "#ef4444" : "#22c55e"}
                strokeWidth="3"
                strokeDasharray={`${kcalPct} ${100 - kcalPct}`}
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute text-center">
              <div className="text-[11px] font-bold tabular-nums">{round0(dayTotals.kcal)}</div>
              <div className="text-[8px] text-gray-400">kcal</div>
            </div>
          </div>
        </div>

        {/* Macro bars */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: "Protein", value: dayTotals.protein_g, target: profile?.proteinTarget, unit: "g", goalType: "min" as const },
            { label: "Carbs", value: dayTotals.carbs_g, target: profile?.carbsTarget, unit: "g", goalType: "max" as const },
            { label: "Fat", value: dayTotals.fat_g, target: profile?.fatTarget, unit: "g", goalType: "max" as const },
            { label: "Fiber", value: dayTotals.fiber_g ?? 0, target: profile?.fiberTarget, unit: "g", goalType: "min" as const },
          ].map((m) => {
            const val = Number(m.value);
            const tgt = m.target ?? null;
            const pct = tgt ? Math.min(100, Math.round((val / tgt) * 100)) : 0;
            const diff = tgt !== null ? tgt - val : null;
            let barColor: string;
            let statusText: string | null = null;
            let statusColor: string;
            if (tgt === null) {
              barColor = "bg-gray-300";
              statusColor = "";
            } else if (m.goalType === "min") {
              barColor = val >= tgt ? "bg-green-500" : "bg-orange-400";
              statusText = diff! > 0 ? `${round1(diff!)}g left` : "\u2713";
              statusColor = diff! > 0 ? "text-orange-500" : "text-green-500";
            } else {
              barColor = val > tgt ? "bg-red-500" : "bg-green-500";
              statusText = diff! >= 0 ? `${round1(diff!)}g left` : `+${round1(-diff!)}g over`;
              statusColor = diff! >= 0 ? "text-gray-400" : "text-red-500";
            }
            return (
              <div key={m.label} className="text-center">
                <div className="text-xs font-bold tabular-nums text-gray-800">{round1(val)}{m.unit}</div>
                <div className="mt-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                  <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-1 text-[10px] text-gray-400">{m.label}</div>
                {statusText && <div className={`text-[9px] font-medium tabular-nums ${statusColor}`}>{statusText}</div>}
              </div>
            );
          })}
        </div>

        {/* Bottom stats */}
        <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
          {kcalDiff >= 0
            ? <span className="tabular-nums">{round0(kcalDiff)} kcal remaining</span>
            : <span className="tabular-nums font-medium text-red-500">{round0(-kcalDiff)} kcal over</span>
          }
          {totalBurned > 0 && (
            <span className="tabular-nums text-blue-600 font-medium">{round0(totalBurned)} burned</span>
          )}
        </div>

        {/* Water tracker */}
        <div className="mt-4 pt-3 border-t border-gray-100">
          <WaterTracker glasses={water?.glasses ?? 0} date={today} />
        </div>
      </Card>

      {/* 2b. SECONDARY: Meal suggestions */}
      <Card>
        <MealSuggestion
          remainingKcal={remainingKcal}
          remainingProtein={remainingProtein}
          remainingCarbs={remainingCarbs}
          remainingFat={remainingFat}
        />
      </Card>

      {/* 3. TERTIARY: Quick actions — copy yesterday + frequent meals */}
      {(copyableMeals.length > 0 || frequentMeals.length > 0) && (
        <div className="rounded-2xl bg-surface-muted p-4 space-y-4">
          <CopyYesterdayMeal meals={copyableMeals} fromDate={yesterday} toDate={today} />
          <FrequentMeals foods={frequentMeals} date={today} />
        </div>
      )}

      {/* Logged meals */}
      {mealsWithEntries.length > 0 && (
        <div className="space-y-3">
          {mealsWithEntries.map((m) => {
            const mealTotals = m.entries.reduce((acc, e) => {
              const n = safeNutrientsForEntry(e, e.food);
              return n ? addNutrients(acc, n) : acc;
            }, emptyTotals());

            const grade = mealGrades.get(m.key);

            return (
              <Card key={m.key}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{m.icon}</span>
                    <span className="text-sm font-bold text-gray-800">{m.label}</span>
                    {grade && (
                      <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${gradeColor(grade as "A" | "B" | "C" | "D")}`}>
                        {grade}
                      </span>
                    )}
                  </div>
                  <span className="text-sm font-semibold tabular-nums text-brand-600">{round0(mealTotals.kcal)} kcal</span>
                </div>
                <div className="space-y-2">
                  {m.entries.map((e) => {
                    const n = safeNutrientsForEntry(e, e.food);
                    const reactions = (e.reactions ?? []) as { id: string; type: string; user: { username: string } }[];
                    return (
                      <div key={e.id} className="rounded-xl bg-surface-muted p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-gray-800">
                              {e.food.name}
                              {e.food.brand && <span className="font-normal text-gray-400"> ({e.food.brand})</span>}
                            </div>
                            <div className="text-xs text-gray-500 tabular-nums mt-0.5">
                              {round1(e.amount)}{e.unit === "GRAM" ? "g" : " srv"}
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
                        {reactions.length > 0 && (
                          <div className="mt-2 flex items-center gap-1 flex-wrap">
                            {reactions.map((r) => (
                              <span key={r.id} className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-xs text-gray-600 shadow-sm">
                                {r.type === "THUMBS_UP" ? "\uD83D\uDC4D" : r.type === "THUMBS_DOWN" ? "\uD83D\uDC4E" : r.type === "FIRE" ? "\uD83D\uDD25" : "\uD83D\uDCAA"}
                                <span className="text-gray-400">{r.user.username}</span>
                              </span>
                            ))}
                          </div>
                        )}
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
        <div className="text-center py-8">
          <div className="text-2xl mb-2">🍽️</div>
          <div className="text-sm font-medium text-gray-500">No meals logged yet today</div>
          <div className="text-xs text-gray-400 mt-1">Use the composer above to get started</div>
        </div>
      )}

      {/* Buddy feed — social card */}
      <BuddyTodayFeed currentUserId={user.id} date={today} />
    </div>
  );
}
