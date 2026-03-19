"use client";

import { useState, useTransition } from "react";
import type { EstimateResponse } from "@/lib/llm";

type Props = {
  date: string;
  defaultMealType?: string;
  onApply: (input: {
    date: string;
    mealType: string;
    mealName?: string;
    estimate: EstimateResponse;
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

export function EstimateFromText({ date, defaultMealType = "DINNER", onApply }: Props) {
  const [text, setText] = useState("");
  const [mealType, setMealType] = useState(defaultMealType);
  const [mealName, setMealName] = useState("");
  const [result, setResult] = useState<EstimateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isApplying, startApplying] = useTransition();

  function handleEstimate() {
    setError(null);
    setResult(null);
    startTransition(async () => {
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
    });
  }

  function handleApply() {
    if (!result) return;
    startApplying(async () => {
      await onApply({ date, mealType, mealName: mealName || undefined, estimate: result, sourceText: text });
      setText("");
      setResult(null);
      setMealName("");
    });
  }

  const totals = result?.items.reduce(
    (acc, item) => ({
      kcal: acc.kcal + item.nutrients.kcal,
      protein_g: acc.protein_g + item.nutrients.protein_g,
      carbs_g: acc.carbs_g + item.nutrients.carbs_g,
      fat_g: acc.fat_g + item.nutrients.fat_g,
    }),
    { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
  );

  return (
    <div className="grid gap-3">
      <div className="grid gap-2 md:grid-cols-2">
        <label className="grid gap-1 text-sm">
          <div className="text-xs font-medium text-gray-500">Meal</div>
          <select
            value={mealType}
            onChange={(e) => setMealType(e.target.value)}
            className="rounded-xl border-0 bg-gray-100 px-3 py-2.5 text-gray-900 focus:ring-2 focus:ring-brand-500"
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
              className="rounded-xl border-0 bg-gray-100 px-3 py-2.5 placeholder-gray-400 focus:ring-2 focus:ring-brand-500"
            />
          </label>
        )}
      </div>

      <label className="grid gap-1 text-sm">
        <div className="text-xs font-medium text-gray-500">Describe your meal</div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g., 2 scrambled eggs, 2 slices of toast with butter, 1 banana"
          rows={3}
          className="rounded-xl border-0 bg-gray-100 px-3 py-2.5 placeholder-gray-400 resize-none focus:ring-2 focus:ring-brand-500"
        />
      </label>

      <button
        onClick={handleEstimate}
        disabled={isPending || !text.trim()}
        className="rounded-xl bg-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-300 disabled:opacity-50 transition-colors"
      >
        {isPending ? "Estimating..." : "Estimate nutrition"}
      </button>

      {error && (
        <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-2">
          {result.items.map((item, i) => (
            <div key={i} className="rounded-xl bg-gray-50 p-3 text-sm">
              <div className="font-semibold text-gray-800">{item.description}</div>
              <div className="text-xs text-gray-500">
                {item.quantity} {item.unit} · confidence {Math.round(item.confidence * 100)}%
              </div>
              <div className="mt-1 text-xs tabular-nums text-gray-700">
                {Math.round(item.nutrients.kcal)} kcal · {item.nutrients.protein_g.toFixed(1)}P / {item.nutrients.carbs_g.toFixed(1)}C / {item.nutrients.fat_g.toFixed(1)}F
              </div>
              {item.assumptions.length > 0 && (
                <div className="mt-1 text-xs text-gray-400">
                  Assumed: {item.assumptions.join("; ")}
                </div>
              )}
            </div>
          ))}

          {totals && (
            <div className="rounded-xl bg-brand-50 px-4 py-2.5 text-sm">
              <span className="text-brand-700 font-semibold tabular-nums">
                {Math.round(totals.kcal)} kcal · {totals.protein_g.toFixed(1)}P / {totals.carbs_g.toFixed(1)}C / {totals.fat_g.toFixed(1)}F
              </span>
            </div>
          )}

          <button
            onClick={handleApply}
            disabled={isApplying}
            className="w-full rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-700 active:scale-[0.98] disabled:opacity-50 transition-all"
          >
            {isApplying ? "Saving..." : "Save meal"}
          </button>
        </div>
      )}
    </div>
  );
}
