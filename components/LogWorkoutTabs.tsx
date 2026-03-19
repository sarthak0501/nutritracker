"use client";

import { useState } from "react";
import { EstimateWorkout } from "@/components/EstimateWorkout";
import type { WorkoutEstimateResponse } from "@/lib/workout-llm";

const MUSCLE_GROUPS = [
  "Chest", "Back", "Legs", "Shoulders", "Arms", "Core", "Cardio", "Full Body",
];

export function LogWorkoutTabs({
  date,
  weightKg,
  onApplyEstimate,
  manualAction,
}: {
  date: string;
  weightKg?: number;
  onApplyEstimate: (input: {
    date: string;
    estimate: WorkoutEstimateResponse;
    sourceText: string;
  }) => Promise<void>;
  manualAction: (formData: FormData) => Promise<void>;
}) {
  const [tab, setTab] = useState<"ai" | "manual">("ai");

  return (
    <div>
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

      {tab === "ai" && (
        <div>
          <EstimateWorkout date={date} weightKg={weightKg} onApply={onApplyEstimate} />
          <div className="mt-2 text-xs text-slate-400">
            Describe your workout and AI estimates calories burned. Mention a muscle group for exercise suggestions.
          </div>
        </div>
      )}

      {tab === "manual" && (
        <form action={manualAction} className="grid gap-3">
          <input type="hidden" name="date" value={date} />
          <div className="grid gap-2 grid-cols-2">
            <label className="grid gap-1 text-sm">
              <div className="text-xs text-slate-500">Exercise name</div>
              <input name="exerciseName" required placeholder="Bench press" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm placeholder-slate-400" />
            </label>
            <label className="grid gap-1 text-sm">
              <div className="text-xs text-slate-500">Muscle group</div>
              <select name="muscleGroup" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900">
                <option value="">—</option>
                {MUSCLE_GROUPS.map((g) => <option key={g} value={g.toLowerCase()}>{g}</option>)}
              </select>
            </label>
          </div>
          <div className="grid gap-2 grid-cols-4">
            <label className="grid gap-1 text-sm">
              <div className="text-xs text-slate-500">Duration (min)</div>
              <input name="durationMinutes" type="number" step="1" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
            </label>
            <label className="grid gap-1 text-sm">
              <div className="text-xs text-slate-500">Sets</div>
              <input name="sets" type="number" step="1" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
            </label>
            <label className="grid gap-1 text-sm">
              <div className="text-xs text-slate-500">Reps</div>
              <input name="reps" type="number" step="1" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
            </label>
            <label className="grid gap-1 text-sm">
              <div className="text-xs text-slate-500">Cal burned</div>
              <input name="caloriesBurned" type="number" step="1" required className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
            </label>
          </div>
          <button className="w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800">
            Add exercise
          </button>
        </form>
      )}
    </div>
  );
}
