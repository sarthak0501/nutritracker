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
          <div className="text-xs text-zinc-400">Meal</div>
          <select
            value={mealType}
            onChange={(e) => setMealType(e.target.value)}
            className="rounded-lg border border-zinc-800 bg-zinc-950/30 px-3 py-2"
          >
            {MEALS.map((m) => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
          </select>
        </label>
        {mealType === "CUSTOM" && (
          <label className="grid gap-1 text-sm">
            <div className="text-xs text-zinc-400">Custom name</div>
            <input
              value={mealName}
              onChange={(e) => setMealName(e.target.value)}
              placeholder="e.g., Post-workout"
              className="rounded-lg border border-zinc-800 bg-zinc-950/30 px-3 py-2"
            />
          </label>
        )}
      </div>

      <label className="grid gap-1 text-sm">
        <div className="text-xs text-zinc-400">Describe your meal</div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g., 2 scrambled eggs, 2 slices of toast with butter, 1 banana"
          rows={3}
          className="rounded-lg border border-zinc-800 bg-zinc-950/30 px-3 py-2 resize-none"
        />
      </label>

      <button
        onClick={handleEstimate}
        disabled={isPending || !text.trim()}
        className="rounded-lg bg-zinc-700 px-3 py-2 text-sm font-medium hover:bg-zinc-600 disabled:opacity-50"
      >
        {isPending ? "Estimating…" : "Estimate nutrition"}
      </button>

      {error && (
        <div className="rounded-lg border border-red-900 bg-red-950/30 px-3 py-2 text-sm text-red-400">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-2">
          {result.items.map((item, i) => (
            <div key={i} className="rounded-lg border border-zinc-800 bg-zinc-950/20 p-3 text-sm">
              <div className="font-medium">{item.description}</div>
              <div className="text-xs text-zinc-400">
                {item.quantity} {item.unit} · confidence {Math.round(item.confidence * 100)}%
              </div>
              <div className="mt-1 text-xs tabular-nums text-zinc-300">
                {Math.round(item.nutrients.kcal)} kcal · {item.nutrients.protein_g.toFixed(1)}P / {item.nutrients.carbs_g.toFixed(1)}C / {item.nutrients.fat_g.toFixed(1)}F
              </div>
              {item.assumptions.length > 0 && (
                <div className="mt-1 text-xs text-zinc-500">
                  Assumed: {item.assumptions.join("; ")}
                </div>
              )}
            </div>
          ))}

          {totals && (
            <div className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm">
              <span className="text-zinc-400">Total: </span>
              <span className="tabular-nums">
                {Math.round(totals.kcal)} kcal · {totals.protein_g.toFixed(1)}P / {totals.carbs_g.toFixed(1)}C / {totals.fat_g.toFixed(1)}F
              </span>
            </div>
          )}

          <button
            onClick={handleApply}
            disabled={isApplying}
            className="w-full rounded-lg bg-zinc-50 px-3 py-2 text-sm font-medium text-zinc-950 hover:bg-white disabled:opacity-50"
          >
            {isApplying ? "Saving…" : "Looks good → Save"}
          </button>
        </div>
      )}
    </div>
  );
}
