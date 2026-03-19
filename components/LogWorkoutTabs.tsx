"use client";

import { useState } from "react";
import { EstimateWorkout } from "@/components/EstimateWorkout";
import { WorkoutRecommendations } from "@/components/WorkoutRecommendations";
import type { WorkoutEstimateResponse, RecommendedExercise } from "@/lib/workout-llm";

const MUSCLE_GROUPS = [
  "Chest", "Back", "Legs", "Shoulders", "Arms", "Core", "Cardio", "Full Body",
];

type ExerciseWithWeight = RecommendedExercise & { userWeightKg?: number };

type PreviousData = {
  exerciseName: string;
  sets: number | null;
  reps: number | null;
  weightKg: number | null;
  date: string;
};

export function LogWorkoutTabs({
  date,
  weightKg,
  profile,
  previousWorkouts,
  onApplyEstimate,
  manualAction,
  onAddRecommended,
  onAddAllRecommended,
}: {
  date: string;
  weightKg?: number;
  profile: {
    equipmentPreset?: string;
    equipment?: string[];
    weightKg?: number;
    heightCm?: number;
    age?: number;
    gender?: string;
  };
  previousWorkouts: PreviousData[];
  onApplyEstimate: (input: {
    date: string;
    estimate: WorkoutEstimateResponse;
    sourceText: string;
  }) => Promise<void>;
  manualAction: (formData: FormData) => Promise<void>;
  onAddRecommended: (input: { date: string; exercise: ExerciseWithWeight }) => Promise<void>;
  onAddAllRecommended: (input: { date: string; exercises: ExerciseWithWeight[] }) => Promise<void>;
}) {
  const [tab, setTab] = useState<"log" | "recommend">("log");
  const [logMode, setLogMode] = useState<"ai" | "manual">("ai");

  return (
    <div>
      {/* Main section tabs */}
      <div className="flex rounded-xl bg-gray-100 p-1 mb-4">
        <button
          onClick={() => setTab("log")}
          className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-all ${
            tab === "log"
              ? "bg-white text-gray-900 shadow-sm"
              : "text-gray-400 hover:text-gray-600"
          }`}
        >
          Log Workout
        </button>
        <button
          onClick={() => setTab("recommend")}
          className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-all ${
            tab === "recommend"
              ? "bg-white text-gray-900 shadow-sm"
              : "text-gray-400 hover:text-gray-600"
          }`}
        >
          Get Recommendations
        </button>
      </div>

      {tab === "log" && (
        <div>
          {/* AI / Manual toggle */}
          <div className="flex gap-1 mb-3">
            <button
              onClick={() => setLogMode("ai")}
              className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition-all ${
                logMode === "ai"
                  ? "bg-gray-200 text-gray-800"
                  : "text-gray-400 hover:text-gray-600"
              }`}
            >
              AI Estimate
            </button>
            <button
              onClick={() => setLogMode("manual")}
              className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition-all ${
                logMode === "manual"
                  ? "bg-gray-200 text-gray-800"
                  : "text-gray-400 hover:text-gray-600"
              }`}
            >
              Manual Entry
            </button>
          </div>

          {logMode === "ai" && (
            <div>
              <EstimateWorkout date={date} weightKg={weightKg} onApply={onApplyEstimate} />
              <div className="mt-2 text-xs text-gray-400">
                Describe your workout and AI estimates calories burned.
              </div>
            </div>
          )}

          {logMode === "manual" && (
            <form action={manualAction} className="grid gap-3">
              <input type="hidden" name="date" value={date} />
              <div className="grid gap-2 grid-cols-2">
                <label className="grid gap-1 text-sm">
                  <div className="text-xs font-medium text-gray-500">Exercise name</div>
                  <input name="exerciseName" required placeholder="Bench press" className="rounded-xl border-0 bg-gray-100 px-3 py-2.5 text-sm placeholder-gray-400 focus:ring-2 focus:ring-brand-500" />
                </label>
                <label className="grid gap-1 text-sm">
                  <div className="text-xs font-medium text-gray-500">Muscle group</div>
                  <select name="muscleGroup" className="rounded-xl border-0 bg-gray-100 px-3 py-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-brand-500">
                    <option value="">—</option>
                    {MUSCLE_GROUPS.map((g) => <option key={g} value={g.toLowerCase()}>{g}</option>)}
                  </select>
                </label>
              </div>
              <div className="grid gap-2 grid-cols-5">
                <label className="grid gap-1 text-sm">
                  <div className="text-xs font-medium text-gray-500">Duration</div>
                  <input name="durationMinutes" type="number" step="1" placeholder="min" className="rounded-xl border-0 bg-gray-100 px-3 py-2.5 text-sm placeholder-gray-400 focus:ring-2 focus:ring-brand-500" />
                </label>
                <label className="grid gap-1 text-sm">
                  <div className="text-xs font-medium text-gray-500">Sets</div>
                  <input name="sets" type="number" step="1" className="rounded-xl border-0 bg-gray-100 px-3 py-2.5 text-sm focus:ring-2 focus:ring-brand-500" />
                </label>
                <label className="grid gap-1 text-sm">
                  <div className="text-xs font-medium text-gray-500">Reps</div>
                  <input name="reps" type="number" step="1" className="rounded-xl border-0 bg-gray-100 px-3 py-2.5 text-sm focus:ring-2 focus:ring-brand-500" />
                </label>
                <label className="grid gap-1 text-sm">
                  <div className="text-xs font-medium text-gray-500">Weight</div>
                  <input name="weightKg" type="number" step="0.5" placeholder="kg" className="rounded-xl border-0 bg-gray-100 px-3 py-2.5 text-sm placeholder-gray-400 focus:ring-2 focus:ring-brand-500" />
                </label>
                <label className="grid gap-1 text-sm">
                  <div className="text-xs font-medium text-gray-500">Cal</div>
                  <input name="caloriesBurned" type="number" step="1" required className="rounded-xl border-0 bg-gray-100 px-3 py-2.5 text-sm focus:ring-2 focus:ring-brand-500" />
                </label>
              </div>
              <button className="w-full rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-700 active:scale-[0.98] transition-all">
                Add exercise
              </button>
            </form>
          )}
        </div>
      )}

      {tab === "recommend" && (
        <WorkoutRecommendations
          date={date}
          profile={profile}
          previousWorkouts={previousWorkouts}
          onAddExercise={onAddRecommended}
          onAddAll={onAddAllRecommended}
        />
      )}
    </div>
  );
}
