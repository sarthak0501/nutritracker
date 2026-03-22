"use client";

import { useState } from "react";
import { EstimateFromText } from "@/components/EstimateFromText";
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
  const [mode, setMode] = useState<"quick" | "fullday" | "manual">("quick");

  return (
    <div>
      {/* Mode selector — two prominent pills + manual fallback */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setMode("quick")}
          className={`flex-1 rounded-xl py-2.5 text-sm font-bold transition-all ${
            mode === "quick"
              ? "bg-brand-600 text-white shadow-sm"
              : "bg-surface-muted text-gray-500 hover:text-gray-700 hover:bg-gray-200"
          }`}
        >
          Quick meal
        </button>
        <button
          onClick={() => setMode("fullday")}
          className={`flex-1 rounded-xl py-2.5 text-sm font-bold transition-all ${
            mode === "fullday"
              ? "bg-brand-600 text-white shadow-sm"
              : "bg-surface-muted text-gray-500 hover:text-gray-700 hover:bg-gray-200"
          }`}
        >
          Full day
        </button>
        <button
          onClick={() => setMode("manual")}
          className={`rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
            mode === "manual"
              ? "bg-gray-800 text-white"
              : "bg-surface-muted text-gray-400 hover:text-gray-600"
          }`}
        >
          Manual
        </button>
      </div>

      {mode === "quick" && (
        <div>
          <EstimateFromText date={date} onApply={onApplyEstimate} onApplyDay={onApplyDay} forceMode="single" />
          <div className="mt-2 text-xs text-gray-400">
            Describe a meal and I'll estimate the macros for you.
          </div>
        </div>
      )}

      {mode === "fullday" && (
        <div>
          <EstimateFromText date={date} onApply={onApplyEstimate} onApplyDay={onApplyDay} forceMode="fullday" />
          <div className="mt-2 text-xs text-gray-400">
            Type breakfast, lunch, dinner, and snacks in one message. I'll organize and estimate everything.
          </div>
        </div>
      )}

      {mode === "manual" && (
        <form action={manualAction} className="grid gap-3">
          <input type="hidden" name="date" value={date} />
          <div className="grid gap-2 grid-cols-2">
            <label className="grid gap-1 text-sm">
              <div className="text-xs font-medium text-gray-500">Meal</div>
              <select name="mealType" className="rounded-xl border-0 bg-surface-muted px-3 py-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-brand-500">
                {MEALS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <div className="text-xs font-medium text-gray-500">Food name</div>
              <input name="name" required placeholder="Greek yogurt" className="rounded-xl border-0 bg-surface-muted px-3 py-2.5 text-sm placeholder-gray-400 focus:ring-2 focus:ring-brand-500" />
            </label>
          </div>
          <div className="grid gap-2 grid-cols-2">
            <label className="grid gap-1 text-sm">
              <div className="text-xs font-medium text-gray-500">Amount (g)</div>
              <input name="amount" type="number" step="1" required defaultValue={100} className="rounded-xl border-0 bg-surface-muted px-3 py-2.5 text-sm focus:ring-2 focus:ring-brand-500" />
            </label>
            <label className="grid gap-1 text-sm">
              <div className="text-xs font-medium text-gray-500">Calories / 100g</div>
              <input name="kcalPer100g" type="number" step="1" required className="rounded-xl border-0 bg-surface-muted px-3 py-2.5 text-sm focus:ring-2 focus:ring-brand-500" />
            </label>
          </div>
          <div className="grid gap-2 grid-cols-3">
            <label className="grid gap-1 text-sm">
              <div className="text-xs font-medium text-gray-500">Protein / 100g</div>
              <input name="proteinPer100g" type="number" step="1" required className="rounded-xl border-0 bg-surface-muted px-3 py-2.5 text-sm focus:ring-2 focus:ring-brand-500" />
            </label>
            <label className="grid gap-1 text-sm">
              <div className="text-xs font-medium text-gray-500">Carbs / 100g</div>
              <input name="carbsPer100g" type="number" step="1" required className="rounded-xl border-0 bg-surface-muted px-3 py-2.5 text-sm focus:ring-2 focus:ring-brand-500" />
            </label>
            <label className="grid gap-1 text-sm">
              <div className="text-xs font-medium text-gray-500">Fat / 100g</div>
              <input name="fatPer100g" type="number" step="1" required className="rounded-xl border-0 bg-surface-muted px-3 py-2.5 text-sm focus:ring-2 focus:ring-brand-500" />
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
