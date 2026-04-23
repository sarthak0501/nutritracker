import { Card } from "@/components/Card";
import { MacroBars } from "@/components/MacroBars";
import { LogEntryCard } from "@/components/LogEntryCard";
import { LogMealTabs } from "@/components/LogMealTabs";
import { applyEstimatedMeal, applyEstimatedDay, createManualFoodAndLogEntry } from "@/app/actions/logging";
import { requireSession } from "@/lib/session";
import { round0, round1, safeNutrientsForEntry, addNutrients } from "@/lib/nutrition";
import { BuddyTodayFeed } from "@/components/BuddyTodayFeed";
import { todayIsoDate, isAnniversaryToday, daysUntilAnniversary } from "@/lib/dates";
import { gradeColor } from "@/lib/meal-scoring";
import { WaterTracker } from "@/components/WaterTracker";
import { CopyYesterdayMeal } from "@/components/CopyYesterdayMeal";
import { FrequentMeals } from "@/components/FrequentMeals";
import { MealSuggestion } from "@/components/MealSuggestion";
import { getTodayDashboardData, emptyTotals } from "@/lib/dashboard";
import { redirect } from "next/navigation";
import { LoveMessage } from "@/components/LoveMessage";
import { AnniversaryCountdown } from "@/components/AnniversaryCountdown";
import { AnniversaryCelebration } from "@/components/AnniversaryCelebration";
import { AmbientHearts } from "@/components/AmbientHearts";
import { LoveLetterButton } from "@/components/LoveLetterButton";
import { NutritionAlerts } from "@/components/NutritionAlerts";

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
    streak,
  } = data;

  const isKavya = user.username === "kavya";
  const annivToday = isAnniversaryToday();
  const daysToAnniv = daysUntilAnniversary();
  const isKavyaAnnivDay = isKavya && annivToday;

  return (
    <div className="space-y-4">
      {isKavya && <LoveMessage mode={annivToday ? "anniversary" : "default"} />}
      {isKavyaAnnivDay && <AmbientHearts />}
      {isKavyaAnnivDay && <LoveLetterButton />}
      {isKavyaAnnivDay && <AnniversaryCelebration />}
      {isKavya && !annivToday && daysToAnniv >= 1 && daysToAnniv <= 3 && (
        <AnniversaryCountdown days={daysToAnniv} />
      )}
      {/* 1. PRIMARY: AI Composer — the hero */}
      <Card variant="action">
        <div className="mb-1 text-lg font-bold text-gray-900">What did you eat today?</div>
        <div className="mb-4 text-xs text-gray-400">Describe a meal or your whole day — I'll estimate and organize it.</div>
        <LogMealTabs
          date={today}
          onApplyEstimate={applyEstimatedMeal}
          onApplyDay={applyEstimatedDay}
          manualAction={createManualFoodAndLogEntry}
        />
      </Card>

      {/* 2. SECONDARY: Day summary */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-xs font-medium text-gray-400 uppercase tracking-wide">{today}</div>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <div className={`text-lg font-bold ${isKavyaAnnivDay ? "text-rose-500" : "text-gray-900"}`}>
                {isKavyaAnnivDay ? "Hi, my love 💕" : `Hi, ${user.name}`}
              </div>
              {isKavyaAnnivDay && (
                <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-xs font-bold text-rose-500 border border-rose-200">
                  💍 Day 1 of Forever
                </span>
              )}
              {streak > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2 py-0.5 text-xs font-bold text-orange-500 border border-orange-100">
                  🔥 {streak}d
                </span>
              )}
            </div>
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
        <MacroBars macros={[
          { label: "Protein", value: dayTotals.protein_g, target: profile?.proteinTarget, unit: "g", goalType: "min" },
          { label: "Carbs", value: dayTotals.carbs_g, target: profile?.carbsTarget, unit: "g", goalType: "max" },
          { label: "Fat", value: dayTotals.fat_g, target: profile?.fatTarget, unit: "g", goalType: "max" },
          { label: "Fiber", value: dayTotals.fiber_g ?? 0, target: profile?.fiberTarget, unit: "g", goalType: "min" },
        ]} />

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

      {/* 3. TERTIARY: Shortcuts — copy yesterday + frequent meals */}
      {(copyableMeals.length > 0 || frequentMeals.length > 0) && (
        <div className="rounded-2xl bg-surface-muted p-4 space-y-4">
          <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Shortcuts</div>
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
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{m.icon}</span>
                    <span className="text-sm font-bold text-gray-800">{m.label}</span>
                    {grade && (
                      <span className={`rounded-lg px-2.5 py-1 text-xs font-extrabold tracking-wide shadow-sm ${gradeColor(grade as "A" | "B" | "C" | "D")}`}>
                        {grade}
                      </span>
                    )}
                  </div>
                  <span className="text-sm font-semibold tabular-nums text-brand-600">{round0(mealTotals.kcal)} kcal</span>
                </div>
                <div className="flex items-center gap-2.5 mb-3 flex-wrap">
                  <span className="text-xs tabular-nums font-medium text-blue-500">{round1(mealTotals.protein_g)}g P</span>
                  <span className="text-[10px] text-gray-300">·</span>
                  <span className="text-xs tabular-nums font-medium text-amber-500">{round1(mealTotals.carbs_g)}g C</span>
                  <span className="text-[10px] text-gray-300">·</span>
                  <span className="text-xs tabular-nums font-medium text-red-400">{round1(mealTotals.fat_g)}g F</span>
                  {(mealTotals.fiber_g ?? 0) > 0 && (
                    <>
                      <span className="text-[10px] text-gray-300">·</span>
                      <span className="text-xs tabular-nums font-medium text-green-500">{round1(mealTotals.fiber_g ?? 0)}g fiber</span>
                    </>
                  )}
                </div>
                <div className="space-y-2">
                  {m.entries.map((e) => {
                    const n = safeNutrientsForEntry(e, e.food);
                    const reactions = (e.reactions ?? []) as { id: string; type: string; user: { username: string } }[];
                    const macroLine = [
                      `${round1(e.amount)}${e.unit === "GRAM" ? "g" : " srv"}`,
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
                      >
                        {reactions.length > 0 && (
                          <div className="mt-2 flex items-center gap-1 flex-wrap">
                            {reactions.map((r) => (
                              <span key={r.id} className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-xs text-gray-600 shadow-sm">
                                {r.type === "THUMBS_UP" ? "👍" : r.type === "THUMBS_DOWN" ? "👎" : r.type === "FIRE" ? "🔥" : "💪"}
                                <span className="text-gray-400">{r.user.username}</span>
                              </span>
                            ))}
                          </div>
                        )}
                      </LogEntryCard>
                    );
                  })}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {entries.length === 0 && (
        <div className="rounded-2xl border-2 border-dashed border-gray-200 py-10 text-center">
          <div className="text-4xl mb-3">🍽️</div>
          <div className="text-sm font-bold text-gray-600">Nothing logged yet today</div>
          <div className="text-xs text-gray-400 mt-1 max-w-xs mx-auto">
            Describe what you ate above — even a rough description works!
          </div>
        </div>
      )}

      {/* Nutrition alerts — week-level patterns */}
      {profile && (
        <NutritionAlerts
          userId={user.id}
          kcalTarget={profile.kcalTarget}
          proteinTarget={profile.proteinTarget}
          fiberTarget={profile.fiberTarget ?? 30}
        />
      )}

      {/* Buddy feed — social section */}
      <BuddyTodayFeed currentUserId={user.id} date={today} />
    </div>
  );
}
