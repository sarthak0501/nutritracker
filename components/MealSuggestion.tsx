"use client";

import { useState, useTransition } from "react";
import type { MealSuggestionResponse } from "@/lib/meal-suggestions";

export function MealSuggestion({
  remainingKcal,
  remainingProtein,
  remainingCarbs,
  remainingFat,
}: {
  remainingKcal: number;
  remainingProtein: number;
  remainingCarbs: number;
  remainingFat: number;
}) {
  const [suggestions, setSuggestions] = useState<MealSuggestionResponse["suggestions"] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Determine meal slot based on time of day
  const hour = new Date().getHours();
  const mealSlot = hour < 11 ? "breakfast" : hour < 15 ? "lunch" : hour < 20 ? "dinner" : "snack";

  async function fetchSuggestions() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/suggest-meal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          remainingKcal,
          remainingProtein,
          remainingCarbs,
          remainingFat,
          mealSlot,
        }),
      });
      if (!res.ok) throw new Error("Failed to get suggestions");
      const data: MealSuggestionResponse = await res.json();
      setSuggestions(data.suggestions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  if (!suggestions) {
    return (
      <button
        onClick={fetchSuggestions}
        disabled={loading || remainingKcal <= 0}
        className="w-full rounded-xl bg-brand-50 px-4 py-3 text-sm font-semibold text-brand-700 hover:bg-brand-100 disabled:opacity-50 transition-all active:scale-[0.98]"
      >
        {loading ? (
          <span className="inline-flex items-center gap-2">
            <span className="animate-spin">⏳</span> Thinking...
          </span>
        ) : remainingKcal <= 0 ? (
          "You've hit your calorie target!"
        ) : (
          `What should I eat for ${mealSlot}?`
        )}
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-gray-400 uppercase tracking-wide">
          Suggestions for {mealSlot}
        </div>
        <button
          onClick={() => setSuggestions(null)}
          className="text-xs text-gray-400 hover:text-gray-600"
        >
          Close
        </button>
      </div>
      {suggestions.map((s, i) => (
        <div key={i} className="rounded-xl bg-gray-50 p-3">
          <div className="font-semibold text-sm text-gray-800">{s.name}</div>
          <div className="text-xs text-gray-500 mt-0.5">{s.description}</div>
          <div className="flex gap-3 mt-2 text-xs tabular-nums text-gray-500">
            <span>{s.estimatedNutrients.kcal} cal</span>
            <span>{s.estimatedNutrients.protein_g}P</span>
            <span>{s.estimatedNutrients.carbs_g}C</span>
            <span>{s.estimatedNutrients.fat_g}F</span>
          </div>
          {s.ingredients.length > 0 && (
            <div className="text-[11px] text-gray-400 mt-1">
              {s.ingredients.join(" · ")}
            </div>
          )}
        </div>
      ))}
      {error && <div className="text-xs text-red-500">{error}</div>}
    </div>
  );
}
