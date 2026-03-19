"use client";

import { useState, useTransition } from "react";
import type { WorkoutRecommendationResponse, RecommendedExercise } from "@/lib/workout-llm";

const FOCUS_OPTIONS = [
  { value: "full body", label: "Full Body" },
  { value: "upper body", label: "Upper Body" },
  { value: "lower body", label: "Lower Body" },
  { value: "chest", label: "Chest" },
  { value: "back", label: "Back" },
  { value: "legs", label: "Legs" },
  { value: "shoulders", label: "Shoulders" },
  { value: "arms", label: "Arms" },
  { value: "core", label: "Core" },
  { value: "cardio", label: "Cardio" },
];

type Props = {
  date: string;
  profile: {
    equipmentPreset?: string;
    equipment?: string[];
    weightKg?: number;
    heightCm?: number;
    age?: number;
    gender?: string;
  };
  onAddExercise: (input: { date: string; exercise: RecommendedExercise }) => Promise<void>;
  onAddAll: (input: { date: string; exercises: RecommendedExercise[] }) => Promise<void>;
};

export function WorkoutRecommendations({ date, profile, onAddExercise, onAddAll }: Props) {
  const [focus, setFocus] = useState("");
  const [customFocus, setCustomFocus] = useState("");
  const [result, setResult] = useState<WorkoutRecommendationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [addedIds, setAddedIds] = useState<Set<number>>(new Set());
  const [addingAll, startAddingAll] = useTransition();

  const activeFocus = focus === "custom" ? customFocus : focus;

  function handleGenerate() {
    if (!activeFocus.trim()) return;
    setError(null);
    setResult(null);
    setAddedIds(new Set());
    startTransition(async () => {
      const res = await fetch("/api/recommend-workout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          focus: activeFocus,
          equipmentPreset: profile.equipmentPreset,
          equipment: profile.equipment,
          weightKg: profile.weightKg,
          heightCm: profile.heightCm,
          age: profile.age,
          gender: profile.gender,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? "Failed to generate recommendations.");
        return;
      }
      setResult(await res.json());
    });
  }

  function handleAddExercise(exercise: RecommendedExercise, index: number) {
    startTransition(async () => {
      await onAddExercise({ date, exercise });
      setAddedIds((prev) => new Set(prev).add(index));
    });
  }

  function handleAddAll() {
    if (!result) return;
    const remaining = result.exercises.filter((_, i) => !addedIds.has(i));
    if (remaining.length === 0) return;
    startAddingAll(async () => {
      await onAddAll({ date, exercises: remaining });
      setAddedIds(new Set(result.exercises.map((_, i) => i)));
    });
  }

  const allAdded = result ? result.exercises.every((_, i) => addedIds.has(i)) : false;

  return (
    <div className="grid gap-3">
      {/* Focus selector */}
      <div className="flex flex-wrap gap-1.5">
        {FOCUS_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => { setFocus(opt.value); setResult(null); setAddedIds(new Set()); }}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              focus === opt.value
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {opt.label}
          </button>
        ))}
        <button
          onClick={() => { setFocus("custom"); setResult(null); setAddedIds(new Set()); }}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            focus === "custom"
              ? "bg-slate-900 text-white"
              : "bg-slate-100 text-slate-600 hover:bg-slate-200"
          }`}
        >
          Other...
        </button>
      </div>

      {focus === "custom" && (
        <input
          value={customFocus}
          onChange={(e) => setCustomFocus(e.target.value)}
          placeholder="e.g., HIIT, stretching, post-run recovery..."
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm placeholder-slate-400"
        />
      )}

      {focus && (
        <button
          onClick={handleGenerate}
          disabled={isPending || !activeFocus.trim()}
          className="rounded-lg bg-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-300 disabled:opacity-50"
        >
          {isPending ? "Generating plan..." : `Generate ${activeFocus} workout`}
        </button>
      )}

      {!profile.equipmentPreset && !profile.equipment?.length && (
        <div className="text-xs text-slate-400">
          Tip: Set your equipment in <a href="/profile" className="underline">Profile</a> for better recommendations.
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-2">
          {/* Workout overview */}
          <div className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm">
            <span className="font-medium">~{Math.round(result.totalEstimatedCalories)} kcal</span>
            <span className="text-slate-500"> · ~{result.totalDurationMinutes} min</span>
          </div>

          {result.warmup && (
            <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700">
              <span className="font-medium">Warmup:</span> {result.warmup}
            </div>
          )}

          {/* Exercises */}
          {result.exercises.map((ex, i) => {
            const added = addedIds.has(i);
            return (
              <div key={i} className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{ex.exerciseName}</div>
                    <div className="text-xs text-slate-500">
                      <span className="capitalize">{ex.muscleGroup}</span>
                      {" · "}{ex.sets}×{ex.reps}
                      {ex.restSeconds && <> · {ex.restSeconds}s rest</>}
                      {ex.durationMinutes && <> · ~{ex.durationMinutes} min</>}
                      {" · ~"}{Math.round(ex.estimatedCalories)} kcal
                    </div>
                    {ex.notes && <div className="mt-1 text-xs text-slate-400">{ex.notes}</div>}
                  </div>
                  <button
                    onClick={() => handleAddExercise(ex, i)}
                    disabled={added || isPending}
                    className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                      added
                        ? "bg-green-100 text-green-600"
                        : "bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
                    }`}
                  >
                    {added ? "Added" : "+ Log"}
                  </button>
                </div>
              </div>
            );
          })}

          {result.cooldown && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
              <span className="font-medium">Cooldown:</span> {result.cooldown}
            </div>
          )}

          {/* Add all button */}
          {!allAdded && (
            <button
              onClick={handleAddAll}
              disabled={addingAll || isPending}
              className="w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {addingAll ? "Adding all..." : "Log entire workout"}
            </button>
          )}

          {allAdded && (
            <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-center text-sm text-green-700 font-medium">
              All exercises logged!
            </div>
          )}

          {result.notes.length > 0 && (
            <div className="text-xs text-slate-400 space-y-0.5">
              {result.notes.map((n, i) => <div key={i}>{n}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
