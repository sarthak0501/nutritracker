"use client";

import { useState } from "react";
import { EstimateFromText } from "@/components/EstimateFromText";
import type { EstimateResponse } from "@/lib/llm";

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
  manualAction: (formData: FormData) => Promise<void>;
}) {
  const [tab, setTab] = useState<"ai" | "manual">("ai");

  return (
    <div>
      {/* Tab buttons */}
      <div className="flex gap-1 mb-4">
        <button
          onClick={() => setTab("ai")}
          className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
            tab === "ai"
              ? "bg-slate-900 text-white"
              : "bg-slate-100 text-slate-500 hover:bg-slate-200"
          }`}
        >
          AI Estimate
        </button>
        <button
          onClick={() => setTab("manual")}
          className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
            tab === "manual"
              ? "bg-slate-900 text-white"
              : "bg-slate-100 text-slate-500 hover:bg-slate-200"
          }`}
        >
          Manual Entry
        </button>
      </div>

      {/* AI tab */}
      {tab === "ai" && (
        <div>
          <EstimateFromText date={date} onApply={onApplyEstimate} />
          <div className="mt-2 text-xs text-slate-400">
            Describe what you ate and AI estimates the macros.
          </div>
        </div>
      )}

      {/* Manual tab */}
      {tab === "manual" && (
        <form action={manualAction} className="grid gap-3">
          <input type="hidden" name="date" value={date} />
          <div className="grid gap-2 grid-cols-2">
            <label className="grid gap-1 text-sm">
              <div className="text-xs text-slate-500">Meal</div>
              <select name="mealType" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900">
                {MEALS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              <div className="text-xs text-slate-500">Food name</div>
              <input name="name" required placeholder="Greek yogurt" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm placeholder-slate-400" />
            </label>
          </div>
          <div className="grid gap-2 grid-cols-2">
            <label className="grid gap-1 text-sm">
              <div className="text-xs text-slate-500">Amount (g)</div>
              <input name="amount" type="number" inputMode="decimal" step="0.1" required defaultValue={100} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
            </label>
            <label className="grid gap-1 text-sm">
              <div className="text-xs text-slate-500">Calories / 100g</div>
              <input name="kcalPer100g" type="number" inputMode="decimal" step="0.1" required className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
            </label>
          </div>
          <div className="grid gap-2 grid-cols-3">
            <label className="grid gap-1 text-sm">
              <div className="text-xs text-slate-500">Protein / 100g</div>
              <input name="proteinPer100g" type="number" inputMode="decimal" step="0.1" required className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
            </label>
            <label className="grid gap-1 text-sm">
              <div className="text-xs text-slate-500">Carbs / 100g</div>
              <input name="carbsPer100g" type="number" inputMode="decimal" step="0.1" required className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
            </label>
            <label className="grid gap-1 text-sm">
              <div className="text-xs text-slate-500">Fat / 100g</div>
              <input name="fatPer100g" type="number" inputMode="decimal" step="0.1" required className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
            </label>
          </div>
          <input type="hidden" name="unit" value="GRAM" />
          <button className="w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800">
            Add entry
          </button>
        </form>
      )}
    </div>
  );
}
