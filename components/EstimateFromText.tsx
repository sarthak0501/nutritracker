"use client";

import { useState, useTransition } from "react";
import type { EstimateResponse } from "@/lib/llm";
import type { DayMeal, DayEstimateResponse } from "@/lib/day-estimate";

type Props = {
  date: string;
  defaultMealType?: string;
  forceMode?: "single" | "fullday";
  onApply: (input: {
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
};

const MEALS = [
  { key: "BREAKFAST", label: "Breakfast" },
  { key: "LUNCH", label: "Lunch" },
  { key: "DINNER", label: "Dinner" },
  { key: "SNACK", label: "Snacks" },
  { key: "CUSTOM", label: "Custom" },
];

const DAY_MEAL_TYPES = [
  { key: "BREAKFAST", label: "Breakfast", icon: "\u{1F305}" },
  { key: "LUNCH", label: "Lunch", icon: "\u{2600}\u{FE0F}" },
  { key: "DINNER", label: "Dinner", icon: "\u{1F319}" },
  { key: "SNACK", label: "Snacks", icon: "\u{1F34E}" },
  { key: "CUSTOM", label: "Custom", icon: "\u{2728}" },
];

function mealIcon(type: string) {
  return DAY_MEAL_TYPES.find((m) => m.key === type)?.icon ?? "\u{1F37D}\u{FE0F}";
}

export function EstimateFromText({ date, defaultMealType = "DINNER", forceMode, onApply, onApplyDay }: Props) {
  const [text, setText] = useState("");
  const [mealType, setMealType] = useState(defaultMealType);
  const [mealName, setMealName] = useState("");

  // Single-meal state
  const [result, setResult] = useState<EstimateResponse | null>(null);

  // Full-day state
  const [dayMeals, setDayMeals] = useState<DayMeal[]>([]);
  const [unparsed, setUnparsed] = useState<string[]>([]);
  const [dayNotes, setDayNotes] = useState("");
  const [hasDayResult, setHasDayResult] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isApplying, startApplying] = useTransition();

  const isFullDay = forceMode === "fullday";
  const charCount = text.length;

  function resetAll() {
    setText("");
    setResult(null);
    setDayMeals([]);
    setUnparsed([]);
    setDayNotes("");
    setHasDayResult(false);
    setMealName("");
    setError(null);
  }

  // --- Estimate (single or day) ---
  function handleEstimate() {
    setError(null);
    setResult(null);
    setDayMeals([]);
    setHasDayResult(false);

    startTransition(async () => {
      try {
        if (isFullDay) {
          const res = await fetch("/api/estimate-day", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            setError(data?.error ?? "Failed to parse your day. Try again.");
            return;
          }
          const data: DayEstimateResponse = await res.json();
          setDayMeals(data.meals);
          setUnparsed(data.unparsed);
          setDayNotes(data.notes);
          setHasDayResult(true);
        } else {
          const res = await fetch("/api/estimate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            setError(data?.error ?? "Estimation failed. Is LLM_ENABLED=true?");
            return;
          }
          setResult(await res.json());
        }
      } catch {
        setError("Failed to connect. Check your network.");
      }
    });
  }

  // --- Save single meal ---
  function handleApply() {
    if (!result) return;
    startApplying(async () => {
      await onApply({ date, mealType, mealName: mealName || undefined, estimate: result, sourceText: text });
      resetAll();
    });
  }

  // --- Save full day ---
  function handleApplyDay() {
    if (dayMeals.length === 0) return;
    startApplying(async () => {
      await onApplyDay({ date, meals: dayMeals, sourceText: text });
      resetAll();
    });
  }

  // --- Day review helpers ---
  function removeItem(mealIdx: number, itemIdx: number) {
    setDayMeals((prev) => {
      const updated = prev.map((m, i) => {
        if (i !== mealIdx) return m;
        return { ...m, items: m.items.filter((_, j) => j !== itemIdx) };
      });
      return updated.filter((m) => m.items.length > 0);
    });
  }

  function changeDayMealType(mealIdx: number, newType: string) {
    setDayMeals((prev) =>
      prev.map((m, i) =>
        i === mealIdx ? { ...m, mealType: newType as DayMeal["mealType"] } : m
      )
    );
  }

  function assignUnparsed(item: string, toMealType: string) {
    setUnparsed((prev) => prev.filter((u) => u !== item));
    const existingIdx = dayMeals.findIndex((m) => m.mealType === toMealType);
    const newItem = {
      description: item,
      quantity: 100,
      unit: "g",
      nutrients: { kcal: 100, protein_g: 5, carbs_g: 10, fat_g: 5 },
      confidence: 0.3,
      assumptions: ["rough estimate \u2014 could not parse precisely"],
    };
    if (existingIdx >= 0) {
      setDayMeals((prev) =>
        prev.map((m, i) =>
          i === existingIdx ? { ...m, items: [...m.items, newItem] } : m
        )
      );
    } else {
      setDayMeals((prev) => [
        ...prev,
        {
          mealType: toMealType as DayMeal["mealType"],
          mealName: null,
          detectedFrom: "manually assigned",
          items: [newItem],
        },
      ]);
    }
  }

  // --- Computed totals ---
  const singleTotals = result?.items.reduce(
    (acc, item) => ({
      kcal: acc.kcal + item.nutrients.kcal,
      protein_g: acc.protein_g + item.nutrients.protein_g,
      carbs_g: acc.carbs_g + item.nutrients.carbs_g,
      fat_g: acc.fat_g + item.nutrients.fat_g,
    }),
    { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
  );

  const dayTotals = dayMeals.reduce(
    (acc, m) => {
      for (const item of m.items) {
        acc.kcal += item.nutrients.kcal;
        acc.protein += item.nutrients.protein_g;
        acc.carbs += item.nutrients.carbs_g;
        acc.fat += item.nutrients.fat_g;
      }
      return acc;
    },
    { kcal: 0, protein: 0, carbs: 0, fat: 0 }
  );

  const totalDayItems = dayMeals.reduce((s, m) => s + m.items.length, 0);

  return (
    <div className="grid gap-3">
      {/* Meal type selector — only for single meal mode */}
      {!isFullDay && !hasDayResult && (
        <div className="grid gap-2 md:grid-cols-2">
          <label className="grid gap-1 text-sm">
            <div className="text-xs font-medium text-gray-500">Meal</div>
            <select
              value={mealType}
              onChange={(e) => setMealType(e.target.value)}
              className="rounded-xl border-0 bg-surface-muted px-3 py-2.5 text-gray-900 focus:ring-2 focus:ring-brand-500"
            >
              {MEALS.map((m) => (
                <option key={m.key} value={m.key}>{m.label}</option>
              ))}
            </select>
          </label>
          {mealType === "CUSTOM" && (
            <label className="grid gap-1 text-sm">
              <div className="text-xs font-medium text-gray-500">Custom name</div>
              <input
                value={mealName}
                onChange={(e) => setMealName(e.target.value)}
                placeholder="e.g., Post-workout"
                className="rounded-xl border-0 bg-surface-muted px-3 py-2.5 placeholder-gray-400 focus:ring-2 focus:ring-brand-500"
              />
            </label>
          )}
        </div>
      )}

      {/* Text input */}
      {!hasDayResult && !result && (
        <>
          <label className="grid gap-1 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-500">
                {isFullDay ? "Tell me everything you ate today" : "What did you eat?"}
              </span>
              {isFullDay && (
                <span className={`text-[10px] tabular-nums ${charCount > 2800 ? "text-red-500" : "text-gray-300"}`}>
                  {charCount}/3000
                </span>
              )}
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(isFullDay ? e.target.value.slice(0, 3000) : e.target.value)}
              placeholder={
                isFullDay
                  ? "Breakfast: 2 eggs, toast, chai. Lunch: chicken burrito bowl. Snack: protein shake after gym. Dinner: dal, rice, salad."
                  : "e.g., 2 scrambled eggs, 2 slices of toast with butter, 1 banana"
              }
              rows={isFullDay ? 4 : 3}
              className="rounded-xl border-0 bg-surface-muted px-3 py-2.5 placeholder-gray-400 resize-none focus:ring-2 focus:ring-brand-500 text-sm"
            />
          </label>

          <button
            onClick={handleEstimate}
            disabled={isPending || text.trim().length < (isFullDay ? 10 : 1)}
            className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50 active:scale-[0.98] transition-all"
          >
            {isPending
              ? isFullDay ? "Parsing your day\u2026" : "Estimating\u2026"
              : isFullDay ? "Parse & organize my day" : "Estimate nutrition"}
          </button>
        </>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
      )}

      {/* ========== SINGLE MEAL RESULT ========== */}
      {result && !isFullDay && (
        <div className="space-y-2">
          {result.items.map((item, i) => (
            <div key={i} className="rounded-xl bg-surface-muted p-3 text-sm">
              <div className="font-semibold text-gray-800">{item.description}</div>
              <div className="text-xs text-gray-500">
                {item.quantity} {item.unit} \u00B7 confidence {Math.round(item.confidence * 100)}%
              </div>
              <div className="mt-1 text-xs tabular-nums text-gray-700">
                {Math.round(item.nutrients.kcal)} kcal \u00B7 {item.nutrients.protein_g.toFixed(1)}P / {item.nutrients.carbs_g.toFixed(1)}C / {item.nutrients.fat_g.toFixed(1)}F
              </div>
              {item.assumptions.length > 0 && (
                <div className="mt-1 text-xs text-gray-400">
                  Assumed: {item.assumptions.join("; ")}
                </div>
              )}
            </div>
          ))}

          {singleTotals && (
            <div className="rounded-xl bg-brand-50 px-4 py-2.5 text-sm">
              <span className="text-brand-700 font-semibold tabular-nums">
                {Math.round(singleTotals.kcal)} kcal \u00B7 {singleTotals.protein_g.toFixed(1)}P / {singleTotals.carbs_g.toFixed(1)}C / {singleTotals.fat_g.toFixed(1)}F
              </span>
            </div>
          )}

          <button
            onClick={handleApply}
            disabled={isApplying}
            className="w-full rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-700 active:scale-[0.98] disabled:opacity-50 transition-all"
          >
            {isApplying ? "Saving\u2026" : "Save meal"}
          </button>
        </div>
      )}

      {/* ========== FULL DAY REVIEW ========== */}
      {hasDayResult && (
        <div className="space-y-4">
          {/* Day summary */}
          <div className="rounded-xl bg-brand-50 px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-brand-700">
                {dayMeals.length} meals \u00B7 {totalDayItems} items
              </span>
              <span className="text-sm font-bold tabular-nums text-brand-800">
                ~{Math.round(dayTotals.kcal)} kcal
              </span>
            </div>
            <div className="mt-1 text-xs tabular-nums text-brand-600">
              {Math.round(dayTotals.protein)}P \u00B7 {Math.round(dayTotals.carbs)}C \u00B7 {Math.round(dayTotals.fat)}F
            </div>
          </div>

          {/* Meal groups */}
          {dayMeals.map((meal, mealIdx) => {
            const mealKcal = meal.items.reduce((s, i) => s + i.nutrients.kcal, 0);
            return (
              <div key={mealIdx} className="rounded-xl border border-gray-100 overflow-hidden">
                <div className="flex items-center justify-between bg-surface-muted px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-base">{mealIcon(meal.mealType)}</span>
                    <select
                      value={meal.mealType}
                      onChange={(e) => changeDayMealType(mealIdx, e.target.value)}
                      className="bg-transparent text-sm font-bold text-gray-800 border-0 p-0 focus:ring-0 cursor-pointer"
                    >
                      {DAY_MEAL_TYPES.map((t) => (
                        <option key={t.key} value={t.key}>{t.label}</option>
                      ))}
                    </select>
                  </div>
                  <span className="text-xs font-semibold tabular-nums text-gray-500">
                    {Math.round(mealKcal)} kcal
                  </span>
                </div>

                <div className="divide-y divide-gray-50">
                  {meal.items.map((item, itemIdx) => (
                    <div key={itemIdx} className="flex items-start gap-2 px-3 py-2.5">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium text-gray-800 truncate">{item.description}</span>
                          {item.confidence < 0.7 && (
                            <span className="shrink-0 text-[10px] text-orange-500" title="Low confidence estimate">⚠️</span>
                          )}
                        </div>
                        <div className="text-xs tabular-nums text-gray-500 mt-0.5">
                          {Math.round(item.quantity)}g \u00B7 {Math.round(item.nutrients.kcal)} cal \u00B7 {item.nutrients.protein_g.toFixed(1)}P {item.nutrients.carbs_g.toFixed(1)}C {item.nutrients.fat_g.toFixed(1)}F
                        </div>
                        {item.assumptions.length > 0 && (
                          <div className="text-[11px] text-gray-400 mt-0.5 truncate" title={item.assumptions.join("; ")}>
                            {item.assumptions[0]}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => removeItem(mealIdx, itemIdx)}
                        className="shrink-0 rounded-lg p-1 text-gray-300 hover:bg-red-50 hover:text-red-400 transition-colors mt-0.5"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>

                {meal.detectedFrom && (
                  <div className="px-3 py-1.5 bg-surface-muted text-[10px] text-gray-400">
                    Detected from: {meal.detectedFrom}
                  </div>
                )}
              </div>
            );
          })}

          {/* Unparsed items */}
          {unparsed.length > 0 && (
            <div className="rounded-xl border border-orange-200 bg-orange-50 p-3">
              <div className="text-xs font-medium text-orange-700 mb-2">Couldn't place these \u2014 assign to a meal:</div>
              {unparsed.map((u, i) => (
                <div key={i} className="flex items-center gap-2 mt-1.5">
                  <span className="text-sm text-orange-800 flex-1 truncate">{u}</span>
                  <select
                    defaultValue=""
                    onChange={(e) => { if (e.target.value) assignUnparsed(u, e.target.value); }}
                    className="rounded-lg border-0 bg-white px-2 py-1 text-xs text-gray-700 focus:ring-1 focus:ring-brand-500"
                  >
                    <option value="" disabled>Assign \u2192</option>
                    {DAY_MEAL_TYPES.map((t) => (
                      <option key={t.key} value={t.key}>{t.label}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}

          {dayNotes && <div className="text-[11px] text-gray-400 px-1">{dayNotes}</div>}

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={resetAll}
              className="flex-1 rounded-xl bg-gray-100 px-4 py-2.5 text-sm font-bold text-gray-600 hover:bg-gray-200 transition-all"
            >
              Start over
            </button>
            <button
              onClick={handleApplyDay}
              disabled={isApplying || dayMeals.length === 0}
              className="flex-1 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-60 active:scale-[0.98] transition-all"
            >
              {isApplying ? "Saving\u2026" : `Log all ${totalDayItems} items`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
