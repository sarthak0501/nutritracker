"use client";

import { useState } from "react";
import { EstimateFromText } from "@/components/EstimateFromText";
import { LogDayFromText } from "@/components/LogDayFromText";
import type { EstimateResponse } from "@/lib/llm";
import type { DayMeal } from "@/lib/day-estimate";

const MEALS = [
  { key: "BREAKFAST", label: "Breakfast" },
  { key: "LUNCH", label: "Lunch" },
  { key: "DINNER", label: "Dinner" },
  { key: "SNACK", label: "Snacks" },
  { key: "CUSTOM", label: "Custom" },
];

export function LogMealTabs({
  date,
  onApplyEstimate,
  onApplyDay,
  manualAction,
}: {
  date: string;
  onApplyEstimate: (input: {
    date: string;
    mealType: string;
    mealName?: string;
    estimate: EstimateResponse;
    sourceText: string;
  }) => Promise<void>;
  onApplyDay: (input: {
    date: string;
    meals: DayMeal[];
    sourceText: string;
  }) => Promise<void>;
  manualAction: (formData: FormData) => Promise<void>;
}) {
  const [tab, setTab] = useState<"ai" | "day" | "manual">("ai");

  return (
    <div>
      <div className="flex rounded-xl bg-gray-100 p-1 mb-4">
        <button
          onClick={() => setTab("ai")}
          className={`flex-1 rounded-lg py-2 text-xs font-semibold transition-all ${
            tab === "ai"
              ? "bg-white text-gray-900 shadow-sm"
              : "text-gray-400 hover:text-gray-600"
          }`}
        >
          One Meal
        </button>
        <button
          onClick={() => setTab("day")}
          className={`flex-1 rounded-lg py-2 text-xs font-semibold transition-all ${
            tab === "day"
              ? "bg-white text-gray-900 shadow-sm"
              : "text-gray-400 hover:text-gray-600"
          }`}
        >
          Full Day
        </button>
        <button
          onClick={() => setTab("manual")}
          className={`flex-1 rounded-lg py-2 text-xs font-semibold transition-all ${
            tab === "manual"
              ? "bg-white text-gray-900 shadow-sm"
              : "text-gray-400 hover:text-gray-600"
          }`}
        >
          Manual
        </button>
      </div>

      {tab === "ai" && (
        <div>
          <EstimateFromText date={date} onApply={onApplyEstimate} />
          <div className="mt-2 text-xs text-gray-400">
            Describe what you ate and AI estimates the macros.
          </div>
        </div>
      )}

      {tab === "day" && (
        <div>
          <LogDayFromText date={date} onApply={onApplyDay} />
          <div className="mt-2 text-xs text-gray-400">
            Describe all your meals at once — AI groups them automatically.
          </div>
        </div>
      )}

      {tab === "manual" && (
        <form action={manualAction} className="grid gap-3">
          <input type="hidden" name="date" value={date} />
          <div className="grid gap-2 grid-cols-2">
            <label className="grid gap-1 text-sm">
              <div className="text-xs font-medium text-gray-500">Meal</div>
              <select name="mealType" className="rounded-xl border-0 bg-gray-100 px-3 py-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-brand-500">
                {MEALS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <div className="text-xs font-medium text-gray-500">Food name</div>
              <input name="name" required placeholder="Greek yogurt" className="rounded-xl border-0 bg-gray-100 px-3 py-2.5 text-sm placeholder-gray-400 focus:ring-2 focus:ring-brand-500" />
            </label>
          </div>
          <div className="grid gap-2 grid-cols-2">
            <label className="grid gap-1 text-sm">
              <div className="text-xs font-medium text-gray-500">Amount (g)</div>
              <input name="amount" type="number" step="1" required defaultValue={100} className="rounded-xl border-0 bg-gray-100 px-3 py-2.5 text-sm focus:ring-2 focus:ring-brand-500" />
            </label>
            <label className="grid gap-1 text-sm">
              <div className="text-xs font-medium text-gray-500">Calories / 100g</div>
              <input name="kcalPer100g" type="number" step="1" required className="rounded-xl border-0 bg-gray-100 px-3 py-2.5 text-sm focus:ring-2 focus:ring-brand-500" />
            </label>
          </div>
          <div className="grid gap-2 grid-cols-3">
            <label className="grid gap-1 text-sm">
              <div className="text-xs font-medium text-gray-500">Protein / 100g</div>
              <input name="proteinPer100g" type="number" step="1" required className="rounded-xl border-0 bg-gray-100 px-3 py-2.5 text-sm focus:ring-2 focus:ring-brand-500" />
            </label>
            <label className="grid gap-1 text-sm">
              <div className="text-xs font-medium text-gray-500">Carbs / 100g</div>
              <input name="carbsPer100g" type="number" step="1" required className="rounded-xl border-0 bg-gray-100 px-3 py-2.5 text-sm focus:ring-2 focus:ring-brand-500" />
            </label>
            <label className="grid gap-1 text-sm">
              <div className="text-xs font-medium text-gray-500">Fat / 100g</div>
              <input name="fatPer100g" type="number" step="1" required className="rounded-xl border-0 bg-gray-100 px-3 py-2.5 text-sm focus:ring-2 focus:ring-brand-500" />
            </label>
          </div>
          <input type="hidden" name="unit" value="GRAM" />
          <button className="w-full rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-700 active:scale-[0.98] transition-all">
            Add entry
          </button>
        </form>
      )}
    </div>
  );
}
