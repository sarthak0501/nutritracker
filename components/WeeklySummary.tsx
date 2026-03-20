"use client";

import { useState } from "react";
import type { WeeklySummaryResponse } from "@/lib/weekly-summary";

type DayData = { date: string; kcal: number; protein: number; carbs: number; fat: number; fiber: number };

export function WeeklySummary({
  days,
  targets,
  workoutDays,
  totalBurned,
  weightChange,
}: {
  days: DayData[];
  targets: { kcal: number; protein: number; carbs: number; fat: number; fiber: number | null };
  workoutDays: number;
  totalBurned: number;
  weightChange: number | null;
}) {
  const [result, setResult] = useState<WeeklySummaryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/weekly-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days, targets, workoutDays, totalBurned, weightChange }),
      });
      if (!res.ok) throw new Error("Failed to generate summary");
      const data: WeeklySummaryResponse = await res.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  const gradeColors: Record<string, string> = {
    A: "bg-green-100 text-green-700",
    B: "bg-blue-100 text-blue-700",
    C: "bg-amber-100 text-amber-700",
    D: "bg-red-100 text-red-700",
    F: "bg-red-200 text-red-800",
  };

  if (!result) {
    return (
      <button
        onClick={generate}
        disabled={loading}
        className="w-full rounded-xl bg-brand-50 px-4 py-3 text-sm font-semibold text-brand-700 hover:bg-brand-100 disabled:opacity-50 transition-all active:scale-[0.98]"
      >
        {loading ? (
          <span className="inline-flex items-center gap-2">
            <span className="animate-spin">⏳</span> Analyzing your week...
          </span>
        ) : (
          "Generate AI Weekly Summary"
        )}
      </button>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-gray-700 leading-relaxed">{result.summary}</p>
        <span className={`shrink-0 rounded-lg px-2.5 py-1 text-lg font-bold ${gradeColors[result.overallGrade] ?? ""}`}>
          {result.overallGrade}
        </span>
      </div>

      {result.highlights.length > 0 && (
        <div className="space-y-1">
          {result.highlights.map((h, i) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              <span className="text-green-500 mt-0.5">✓</span>
              <span className="text-gray-600">{h}</span>
            </div>
          ))}
        </div>
      )}

      {result.suggestions.length > 0 && (
        <div className="space-y-1">
          {result.suggestions.map((s, i) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              <span className="text-amber-500 mt-0.5">→</span>
              <span className="text-gray-600">{s}</span>
            </div>
          ))}
        </div>
      )}

      {error && <div className="text-xs text-red-500">{error}</div>}
    </div>
  );
}
