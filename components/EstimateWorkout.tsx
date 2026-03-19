"use client";

import { useState, useTransition } from "react";
import type { WorkoutEstimateResponse } from "@/lib/workout-llm";

type Props = {
  date: string;
  weightKg?: number;
  onApply: (input: {
    date: string;
    estimate: WorkoutEstimateResponse;
    sourceText: string;
  }) => Promise<void>;
};

export function EstimateWorkout({ date, weightKg, onApply }: Props) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<WorkoutEstimateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isApplying, startApplying] = useTransition();

  function handleEstimate() {
    setError(null);
    setResult(null);
    startTransition(async () => {
      const res = await fetch("/api/estimate-workout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, weightKg }),
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
      await onApply({ date, estimate: result, sourceText: text });
      setText("");
      setResult(null);
    });
  }

  const totalCal = result?.exercises.reduce((s, e) => s + e.caloriesBurned, 0) ?? 0;

  return (
    <div className="grid gap-3">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="e.g., 30 min run, then 3x10 bench press at 80kg"
        rows={2}
        className="rounded-xl border-0 bg-gray-100 px-3 py-2.5 placeholder-gray-400 resize-none text-sm focus:ring-2 focus:ring-brand-500"
      />

      <button
        onClick={handleEstimate}
        disabled={isPending || !text.trim()}
        className="rounded-xl bg-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-300 disabled:opacity-50 transition-colors"
      >
        {isPending ? "Estimating..." : "Estimate & log"}
      </button>

      {error && (
        <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
      )}

      {result && (
        <div className="space-y-2">
          {result.exercises.map((ex, i) => (
            <div key={i} className="rounded-xl bg-gray-50 p-3 text-sm">
              <div className="font-semibold text-gray-800">{ex.exerciseName}</div>
              <div className="text-xs text-gray-500">
                {ex.muscleGroup && <span className="capitalize">{ex.muscleGroup} · </span>}
                {ex.durationMinutes && <span>{ex.durationMinutes} min · </span>}
                {ex.sets && ex.reps && <span>{ex.sets}×{ex.reps} · </span>}
                ~{Math.round(ex.caloriesBurned)} kcal
              </div>
            </div>
          ))}

          <div className="rounded-xl bg-blue-50 px-4 py-2.5 text-sm">
            <span className="text-blue-700 font-semibold">Total: ~{Math.round(totalCal)} kcal burned</span>
          </div>

          <button
            onClick={handleApply}
            disabled={isApplying}
            className="w-full rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-700 active:scale-[0.98] disabled:opacity-50 transition-all"
          >
            {isApplying ? "Saving..." : "Save workout"}
          </button>
        </div>
      )}
    </div>
  );
}
