"use client";

import { useState } from "react";
import { LogMealTabs } from "@/components/LogMealTabs";
import { CopyYesterdayMeal } from "@/components/CopyYesterdayMeal";
import { FrequentMeals, type FrequentFood } from "@/components/FrequentMeals";
import { MealSuggestion } from "@/components/MealSuggestion";
import type { EstimateResponse } from "@/lib/llm";

type CopyableMeal = {
  mealType: string;
  label: string;
  icon: string;
  itemCount: number;
  totalKcal: number;
};

export function LogSection({
  date,
  onApplyEstimate,
  manualAction,
  copyableMeals,
  yesterday,
  frequentMeals,
  remainingKcal,
  remainingProtein,
  remainingCarbs,
  remainingFat,
}: {
  date: string;
  onApplyEstimate: (input: {
    date: string;
    mealType: string;
    mealName?: string;
    estimate: EstimateResponse;
    sourceText: string;
  }) => Promise<void>;
  manualAction: (formData: FormData) => Promise<void>;
  copyableMeals: CopyableMeal[];
  yesterday: string;
  frequentMeals: FrequentFood[];
  remainingKcal: number;
  remainingProtein: number;
  remainingCarbs: number;
  remainingFat: number;
}) {
  const [open, setOpen] = useState(false);

  const hasQuickActions = copyableMeals.length > 0 || frequentMeals.length > 0;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full rounded-2xl bg-white p-4 text-left transition-all hover:shadow-sm active:scale-[0.995] border border-gray-100"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-brand-50 text-brand-600">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </div>
            <div>
              <div className="text-sm font-semibold text-gray-800">Log a meal</div>
              <div className="text-xs text-gray-400">AI estimate, manual, or quick log</div>
            </div>
          </div>
          <svg className="w-4 h-4 text-gray-300" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>
    );
  }

  return (
    <div className="rounded-2xl bg-white border border-gray-100 overflow-hidden">
      {/* Header — tap to collapse */}
      <button
        onClick={() => setOpen(false)}
        className="w-full flex items-center justify-between p-4 pb-3 text-left hover:bg-gray-50/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-brand-50 text-brand-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          </div>
          <div className="text-sm font-semibold text-gray-800">Log a meal</div>
        </div>
        <svg className="w-4 h-4 text-gray-300 rotate-180" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      <div className="px-4 pb-4 space-y-4">
        {/* Quick actions: copy yesterday + frequent foods */}
        {hasQuickActions && (
          <div className="space-y-3">
            <CopyYesterdayMeal meals={copyableMeals} fromDate={yesterday} toDate={date} />
            <FrequentMeals foods={frequentMeals} date={date} />
          </div>
        )}

        {/* AI meal suggestion */}
        <MealSuggestion
          remainingKcal={remainingKcal}
          remainingProtein={remainingProtein}
          remainingCarbs={remainingCarbs}
          remainingFat={remainingFat}
        />

        {/* Divider */}
        <div className="border-t border-gray-100" />

        {/* AI / Manual tabs */}
        <LogMealTabs
          date={date}
          onApplyEstimate={onApplyEstimate}
          manualAction={manualAction}
        />
      </div>
    </div>
  );
}
