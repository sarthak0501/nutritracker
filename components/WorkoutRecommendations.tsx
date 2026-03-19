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

type ExerciseWithWeight = RecommendedExercise & { userWeightKg?: number };

type PreviousData = {
  exerciseName: string;
  sets: number | null;
  reps: number | null;
  weightKg: number | null;
  date: string;
};

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
  previousWorkouts: PreviousData[];
  onAddExercise: (input: { date: string; exercise: ExerciseWithWeight }) => Promise<void>;
  onAddAll: (input: { date: string; exercises: ExerciseWithWeight[] }) => Promise<void>;
};

export function WorkoutRecommendations({ date, profile, previousWorkouts, onAddExercise, onAddAll }: Props) {
  const [focus, setFocus] = useState("");
  const [customFocus, setCustomFocus] = useState("");
  const [result, setResult] = useState<WorkoutRecommendationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [addedIds, setAddedIds] = useState<Set<number>>(new Set());
  const [addingAll, startAddingAll] = useTransition();

  // Per-exercise weight inputs and editable sets/reps
  const [weights, setWeights] = useState<Record<number, string>>({});
  const [editSets, setEditSets] = useState<Record<number, string>>({});
  const [editReps, setEditReps] = useState<Record<number, string>>({});

  const activeFocus = focus === "custom" ? customFocus : focus;

  // Find previous data for an exercise name
  function findPrevious(name: string): PreviousData | undefined {
    return previousWorkouts.find(
      (p) => p.exerciseName.toLowerCase() === name.toLowerCase()
    );
  }

  function handleGenerate() {
    if (!activeFocus.trim()) return;
    setError(null);
    setResult(null);
    setAddedIds(new Set());
    setWeights({});
    setEditSets({});
    setEditReps({});
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
      const data: WorkoutRecommendationResponse = await res.json();
      setResult(data);

      // Auto-populate from previous workouts
      const newWeights: Record<number, string> = {};
      const newSets: Record<number, string> = {};
      const newReps: Record<number, string> = {};
      data.exercises.forEach((ex, i) => {
        const prev = findPrevious(ex.exerciseName);
        if (prev) {
          if (prev.weightKg) newWeights[i] = String(prev.weightKg);
          if (prev.sets) newSets[i] = String(prev.sets);
          if (prev.reps) newReps[i] = String(prev.reps);
        }
      });
      setWeights(newWeights);
      setEditSets(newSets);
      setEditReps(newReps);
    });
  }

  function getExerciseWithOverrides(ex: RecommendedExercise, i: number): ExerciseWithWeight {
    const w = weights[i] ? Number(weights[i]) : undefined;
    const s = editSets[i] ? Number(editSets[i]) : ex.sets;
    const r = editReps[i] ? Number(editReps[i]) : ex.reps;
    return { ...ex, sets: s, reps: r, userWeightKg: w };
  }

  function isWeightRequired(ex: RecommendedExercise): boolean {
    // Cardio/bodyweight exercises don't need weight input
    const noWeightKeywords = ["run", "jog", "walk", "plank", "crunch", "push-up", "pushup",
      "pull-up", "pullup", "burpee", "jumping", "mountain climber", "stretch", "yoga",
      "cycling", "bike", "swim", "skip", "rope"];
    const name = ex.exerciseName.toLowerCase();
    const group = (ex.muscleGroup ?? "").toLowerCase();
    if (group === "cardio" || group === "core") return false;
    return !noWeightKeywords.some((kw) => name.includes(kw));
  }

  function canLog(i: number, ex: RecommendedExercise): boolean {
    if (!isWeightRequired(ex)) return true;
    const w = weights[i];
    return !!w && Number(w) > 0;
  }

  function canLogAll(): boolean {
    if (!result) return false;
    return result.exercises.every((ex, i) => addedIds.has(i) || canLog(i, ex));
  }

  function handleAddExercise(ex: RecommendedExercise, index: number) {
    if (!canLog(index, ex)) return;
    const withOverrides = getExerciseWithOverrides(ex, index);
    startTransition(async () => {
      await onAddExercise({ date, exercise: withOverrides });
      setAddedIds((prev) => new Set(prev).add(index));
    });
  }

  function handleAddAll() {
    if (!result || !canLogAll()) return;
    const remaining = result.exercises
      .map((ex, i) => ({ ex, i }))
      .filter(({ i }) => !addedIds.has(i));
    const exercisesWithOverrides = remaining.map(({ ex, i }) => getExerciseWithOverrides(ex, i));
    startAddingAll(async () => {
      await onAddAll({ date, exercises: exercisesWithOverrides });
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
            const needsWeight = isWeightRequired(ex);
            const prev = findPrevious(ex.exerciseName);
            const ready = canLog(i, ex);

            return (
              <div key={i} className="rounded-lg border border-slate-200 bg-white p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{ex.exerciseName}</div>
                    <div className="text-xs text-slate-500">
                      <span className="capitalize">{ex.muscleGroup}</span>
                      {" · "}{editSets[i] || ex.sets}×{editReps[i] || ex.reps}
                      {ex.restSeconds && <> · {ex.restSeconds}s rest</>}
                      {ex.durationMinutes && <> · ~{ex.durationMinutes} min</>}
                      {" · ~"}{Math.round(ex.estimatedCalories)} kcal
                    </div>
                    {ex.notes && <div className="mt-1 text-xs text-slate-400">{ex.notes}</div>}
                  </div>
                  <button
                    onClick={() => handleAddExercise(ex, i)}
                    disabled={added || isPending || !ready}
                    className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                      added
                        ? "bg-green-100 text-green-600"
                        : ready
                        ? "bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50"
                        : "bg-slate-200 text-slate-400 cursor-not-allowed"
                    }`}
                  >
                    {added ? "Logged" : "+ Log"}
                  </button>
                </div>

                {/* Previous history banner */}
                {prev && !added && (
                  <div className="rounded-md bg-blue-50 border border-blue-100 px-2.5 py-1.5 text-xs text-blue-700">
                    Last: {prev.weightKg ? `${prev.weightKg}kg` : "—"} · {prev.sets ?? "—"}×{prev.reps ?? "—"} on {prev.date}
                  </div>
                )}

                {/* Editable fields — only if not yet logged */}
                {!added && (
                  <div className="flex gap-2">
                    {needsWeight && (
                      <label className="grid gap-0.5 text-xs flex-1">
                        <span className="text-slate-500">Weight (kg) *</span>
                        <input
                          type="number"
                          step="0.5"
                          value={weights[i] ?? ""}
                          onChange={(e) => setWeights((p) => ({ ...p, [i]: e.target.value }))}
                          placeholder={prev?.weightKg ? String(prev.weightKg) : "kg"}
                          className={`rounded-md border px-2 py-1.5 text-sm ${
                            needsWeight && !weights[i]
                              ? "border-amber-300 bg-amber-50"
                              : "border-slate-300 bg-white"
                          }`}
                        />
                      </label>
                    )}
                    <label className="grid gap-0.5 text-xs w-16">
                      <span className="text-slate-500">Sets</span>
                      <input
                        type="number"
                        step="1"
                        value={editSets[i] ?? ex.sets}
                        onChange={(e) => setEditSets((p) => ({ ...p, [i]: e.target.value }))}
                        className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
                      />
                    </label>
                    <label className="grid gap-0.5 text-xs w-16">
                      <span className="text-slate-500">Reps</span>
                      <input
                        type="number"
                        step="1"
                        value={editReps[i] ?? ex.reps}
                        onChange={(e) => setEditReps((p) => ({ ...p, [i]: e.target.value }))}
                        className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
                      />
                    </label>
                  </div>
                )}
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
              disabled={addingAll || isPending || !canLogAll()}
              className="w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {addingAll ? "Logging all..." : !canLogAll() ? "Enter weights to log workout" : "Log entire workout"}
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
