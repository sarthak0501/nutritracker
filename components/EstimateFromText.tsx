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
      const data = await res.json();
      setResult(data);
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
          <div className="text-xs text-slate-500">Meal</div>
          <select
            value={mealType}
            onChange={(e) => setMealType(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900"
          >
            {MEALS.map((m) => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
          </select>
        </label>
        {mealType === "CUSTOM" && (
          <label className="grid gap-1 text-sm">
            <div className="text-xs text-slate-500">Custom name</div>
            <input
              value={mealName}
              onChange={(e) => setMealName(e.target.value)}
              placeholder="e.g., Post-workout"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 placeholder-slate-400"
            />
          </label>
        )}
      </div>

      <label className="grid gap-1 text-sm">
        <div className="text-xs text-slate-500">Describe your meal</div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g., 2 scrambled eggs, 2 slices of toast with butter, 1 banana"
          rows={3}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 placeholder-slate-400 resize-none"
        />
      </label>

      <button
        onClick={handleEstimate}
        disabled={isPending || !text.trim()}
        className="rounded-lg bg-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-300 disabled:opacity-50"
      >
        {isPending ? "Estimating…" : "Estimate nutrition"}
      </button>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-2">
          {result.items.map((item, i) => (
            <div key={i} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
              <div className="font-medium">{item.description}</div>
              <div className="text-xs text-slate-500">
                {item.quantity} {item.unit} · confidence {Math.round(item.confidence * 100)}%
              </div>
              <div className="mt-1 text-xs tabular-nums text-slate-700">
                {Math.round(item.nutrients.kcal)} kcal · {item.nutrients.protein_g.toFixed(1)}P / {item.nutrients.carbs_g.toFixed(1)}C / {item.nutrients.fat_g.toFixed(1)}F
              </div>
              {item.assumptions.length > 0 && (
                <div className="mt-1 text-xs text-slate-400">
                  Assumed: {item.assumptions.join("; ")}
                </div>
              )}
            </div>
          ))}

          {totals && (
            <div className="rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm">
              <span className="text-slate-500">Total: </span>
              <span className="tabular-nums text-slate-800">
                {Math.round(totals.kcal)} kcal · {totals.protein_g.toFixed(1)}P / {totals.carbs_g.toFixed(1)}C / {totals.fat_g.toFixed(1)}F
              </span>
            </div>
          )}

          <button
            onClick={handleApply}
            disabled={isApplying}
            className="w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {isApplying ? "Saving…" : "Looks good → Save"}
          </button>
        </div>
      )}
    </div>
  );
}
