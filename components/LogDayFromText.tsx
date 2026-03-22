"use client";

import { useState, useTransition } from "react";
import type { DayEstimateResponse, DayMeal } from "@/lib/day-estimate";

const MEAL_TYPES = [
  { key: "BREAKFAST", label: "Breakfast", icon: "🌅" },
  { key: "LUNCH", label: "Lunch", icon: "☀️" },
  { key: "DINNER", label: "Dinner", icon: "🌙" },
  { key: "SNACK", label: "Snacks", icon: "🍎" },
  { key: "CUSTOM", label: "Custom", icon: "✨" },
];

function mealMeta(type: string) {
  return MEAL_TYPES.find((m) => m.key === type) ?? { key: type, label: type, icon: "🍽️" };
}

type Props = {
  date: string;
  onApply: (input: {
    date: string;
    meals: DayMeal[];
    sourceText: string;
  }) => Promise<void>;
};

export function LogDayFromText({ date, onApply }: Props) {
  const [text, setText] = useState("");
  const [meals, setMeals] = useState<DayMeal[]>([]);
  const [unparsed, setUnparsed] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [hasResult, setHasResult] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isParsing, startParsing] = useTransition();
  const [isSaving, startSaving] = useTransition();

  const charCount = text.length;
  const totalItems = meals.reduce((s, m) => s + m.items.length, 0);
  const dayTotals = meals.reduce(
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

  function handleParse() {
    setError(null);
    startParsing(async () => {
      try {
        const res = await fetch("/api/estimate-day", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data?.error ?? "Failed to parse. Try again.");
          return;
        }
        const data: DayEstimateResponse = await res.json();
        setMeals(data.meals);
        setUnparsed(data.unparsed);
        setNotes(data.notes);
        setHasResult(true);
      } catch {
        setError("Failed to connect. Check your network.");
      }
    });
  }

  function handleSaveAll() {
    if (meals.length === 0) return;
    startSaving(async () => {
      await onApply({ date, meals, sourceText: text });
      setText("");
      setMeals([]);
      setUnparsed([]);
      setNotes("");
      setHasResult(false);
    });
  }

  function handleStartOver() {
    setMeals([]);
    setUnparsed([]);
    setNotes("");
    setHasResult(false);
    setError(null);
  }

  function removeItem(mealIdx: number, itemIdx: number) {
    setMeals((prev) => {
      const updated = prev.map((m, i) => {
        if (i !== mealIdx) return m;
        return { ...m, items: m.items.filter((_, j) => j !== itemIdx) };
      });
      return updated.filter((m) => m.items.length > 0);
    });
  }

  function changeMealType(mealIdx: number, newType: string) {
    setMeals((prev) =>
      prev.map((m, i) =>
        i === mealIdx ? { ...m, mealType: newType as DayMeal["mealType"] } : m
      )
    );
  }

  function assignUnparsed(text: string, mealType: string) {
    // Move unparsed item as a new meal entry (user can re-parse or discard)
    setUnparsed((prev) => prev.filter((u) => u !== text));
    const existingIdx = meals.findIndex((m) => m.mealType === mealType);
    if (existingIdx >= 0) {
      setMeals((prev) =>
        prev.map((m, i) =>
          i === existingIdx
            ? {
                ...m,
                items: [
                  ...m.items,
                  {
                    description: text,
                    quantity: 100,
                    unit: "g",
                    nutrients: { kcal: 100, protein_g: 5, carbs_g: 10, fat_g: 5 },
                    confidence: 0.3,
                    assumptions: ["rough estimate — could not parse precisely"],
                  },
                ],
              }
            : m
        )
      );
    } else {
      setMeals((prev) => [
        ...prev,
        {
          mealType: mealType as DayMeal["mealType"],
          mealName: null,
          detectedFrom: "manually assigned from unparsed",
          items: [
            {
              description: text,
              quantity: 100,
              unit: "g",
              nutrients: { kcal: 100, protein_g: 5, carbs_g: 10, fat_g: 5 },
              confidence: 0.3,
              assumptions: ["rough estimate — could not parse precisely"],
            },
          ],
        },
      ]);
    }
  }

  // --- Input mode ---
  if (!hasResult) {
    return (
      <div className="grid gap-3">
        <label className="grid gap-1 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-500">Describe your whole day</span>
            <span className={`text-[10px] tabular-nums ${charCount > 2800 ? "text-red-500" : "text-gray-300"}`}>
              {charCount}/3000
            </span>
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 3000))}
            placeholder={"Breakfast: 2 eggs, toast, chai. Lunch: chicken burrito bowl. Snack: protein shake after gym. Dinner: dal, rice, salad."}
            rows={4}
            className="rounded-xl border-0 bg-gray-100 px-3 py-2.5 placeholder-gray-400 resize-none focus:ring-2 focus:ring-brand-500 text-sm"
          />
        </label>

        <button
          onClick={handleParse}
          disabled={isParsing || text.trim().length < 10}
          className="rounded-xl bg-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-300 disabled:opacity-50 transition-colors"
        >
          {isParsing ? "Parsing your day…" : "Parse & review"}
        </button>

        {error && (
          <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
        )}
      </div>
    );
  }

  // --- Review mode ---
  return (
    <div className="space-y-4">
      {/* Day summary */}
      <div className="rounded-xl bg-brand-50 px-4 py-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-brand-700">
            {meals.length} meals · {totalItems} items
          </span>
          <span className="text-sm font-bold tabular-nums text-brand-800">
            ~{Math.round(dayTotals.kcal)} kcal
          </span>
        </div>
        <div className="mt-1 text-xs tabular-nums text-brand-600">
          {Math.round(dayTotals.protein)}P · {Math.round(dayTotals.carbs)}C · {Math.round(dayTotals.fat)}F
        </div>
      </div>

      {/* Meal groups */}
      {meals.map((meal, mealIdx) => {
        const meta = mealMeta(meal.mealType);
        const mealKcal = meal.items.reduce((s, i) => s + i.nutrients.kcal, 0);

        return (
          <div key={mealIdx} className="rounded-xl border border-gray-100 overflow-hidden">
            {/* Meal header */}
            <div className="flex items-center justify-between bg-gray-50 px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="text-base">{meta.icon}</span>
                <select
                  value={meal.mealType}
                  onChange={(e) => changeMealType(mealIdx, e.target.value)}
                  className="bg-transparent text-sm font-bold text-gray-800 border-0 p-0 focus:ring-0 cursor-pointer"
                >
                  {MEAL_TYPES.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <span className="text-xs font-semibold tabular-nums text-gray-500">
                {Math.round(mealKcal)} kcal
              </span>
            </div>

            {/* Items */}
            <div className="divide-y divide-gray-50">
              {meal.items.map((item, itemIdx) => (
                <div key={itemIdx} className="flex items-start gap-2 px-3 py-2.5">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-gray-800 truncate">
                        {item.description}
                      </span>
                      {item.confidence < 0.7 && (
                        <span className="shrink-0 text-[10px] text-orange-500" title="Low confidence estimate">⚠️</span>
                      )}
                    </div>
                    <div className="text-xs tabular-nums text-gray-500 mt-0.5">
                      {Math.round(item.quantity)}g · {Math.round(item.nutrients.kcal)} cal · {item.nutrients.protein_g.toFixed(1)}P {item.nutrients.carbs_g.toFixed(1)}C {item.nutrients.fat_g.toFixed(1)}F
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

            {/* Detection hint */}
            {meal.detectedFrom && (
              <div className="px-3 py-1.5 bg-gray-50 text-[10px] text-gray-400">
                Detected from: {meal.detectedFrom}
              </div>
            )}
          </div>
        );
      })}

      {/* Unparsed items */}
      {unparsed.length > 0 && (
        <div className="rounded-xl border border-orange-200 bg-orange-50 p-3">
          <div className="text-xs font-medium text-orange-700 mb-2">Couldn't place these — assign to a meal:</div>
          {unparsed.map((item, i) => (
            <div key={i} className="flex items-center gap-2 mt-1.5">
              <span className="text-sm text-orange-800 flex-1 truncate">{item}</span>
              <select
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) assignUnparsed(item, e.target.value);
                }}
                className="rounded-lg border-0 bg-white px-2 py-1 text-xs text-gray-700 focus:ring-1 focus:ring-brand-500"
              >
                <option value="" disabled>Assign →</option>
                {MEAL_TYPES.map((t) => (
                  <option key={t.key} value={t.key}>{t.label}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}

      {/* Notes from parser */}
      {notes && (
        <div className="text-[11px] text-gray-400 px-1">{notes}</div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={handleStartOver}
          className="flex-1 rounded-xl bg-gray-100 px-4 py-2.5 text-sm font-bold text-gray-600 hover:bg-gray-200 transition-all"
        >
          Start over
        </button>
        <button
          onClick={handleSaveAll}
          disabled={isSaving || meals.length === 0}
          className="flex-1 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-60 active:scale-[0.98] transition-all"
        >
          {isSaving ? "Saving…" : `Log all ${totalItems} items`}
        </button>
      </div>
    </div>
  );
}
