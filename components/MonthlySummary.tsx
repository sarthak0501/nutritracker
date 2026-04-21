"use client";

import { useState } from "react";
import type { MonthlyDay, MonthlyWeight, MonthlySignals, MonthlySummaryResponse } from "@/lib/monthly-summary";

type Props = {
  days: MonthlyDay[];
  targets: { kcal: number; protein: number; carbs: number; fat: number; fiber: number | null };
  weights: MonthlyWeight[];
  rangeDays: number;
};

const MIN_COVERAGE_DAYS = 10;

export function MonthlySummary({ days, targets, weights, rangeDays }: Props) {
  const [result, setResult] = useState<{ signals: MonthlySignals; summary: MonthlySummaryResponse } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loggedDays = days.filter((d) => d.kcal > 0).length;
  const coverageOk = loggedDays >= MIN_COVERAGE_DAYS;

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/monthly-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days, targets, weights, rangeDays }),
      });
      if (!res.ok) throw new Error("Failed to generate summary");
      const data = (await res.json()) as { signals: MonthlySignals; summary: MonthlySummaryResponse };
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

  if (!coverageOk) {
    const needed = MIN_COVERAGE_DAYS - loggedDays;
    return (
      <div className="rounded-xl bg-surface-muted px-4 py-5 text-center">
        <div className="text-2xl mb-2">📊</div>
        <div className="text-sm font-semibold text-gray-700">
          Log {needed} more {needed === 1 ? "day" : "days"} to unlock your month review
        </div>
        <div className="text-xs text-gray-500 mt-1.5">
          You've logged {loggedDays} of the last {rangeDays} days. We need at least {MIN_COVERAGE_DAYS} for meaningful insights.
        </div>
      </div>
    );
  }

  if (!result) {
    return (
      <button
        onClick={generate}
        disabled={loading}
        className="w-full rounded-xl bg-brand-50 px-4 py-3 text-sm font-semibold text-brand-700 hover:bg-brand-100 disabled:opacity-50 transition-all active:scale-[0.98]"
      >
        {loading ? (
          <span className="inline-flex items-center gap-2">
            <span className="animate-spin">⏳</span> Analyzing your month...
          </span>
        ) : (
          `Generate AI Month Review (${loggedDays}/${rangeDays} days logged)`
        )}
      </button>
    );
  }

  const { signals, summary } = result;
  const verdictPill = verdictPillFor(signals.accuracyVerdict);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-gray-700 leading-relaxed">{summary.summary}</p>
        <span className={`shrink-0 rounded-lg px-2.5 py-1 text-lg font-bold ${gradeColors[summary.overallGrade] ?? ""}`}>
          {summary.overallGrade}
        </span>
      </div>

      {/* Signal chips */}
      <div className="flex flex-wrap gap-1.5">
        <Chip label={`${signals.coveragePct}% logged`} tone="gray" />
        {signals.currentStreak > 0 && <Chip label={`🔥 ${signals.currentStreak}d streak`} tone="orange" />}
        {signals.kcalConsistencyCv !== null && (
          <Chip
            label={`${signals.kcalConsistencyCv}% kcal CV`}
            tone={signals.kcalConsistencyCv <= 20 ? "green" : signals.kcalConsistencyCv <= 35 ? "amber" : "red"}
          />
        )}
        {signals.weekdayAvgKcal !== null && signals.weekendAvgKcal !== null && (
          <Chip
            label={`wkd ${signals.weekdayAvgKcal} / wknd ${signals.weekendAvgKcal}`}
            tone="gray"
          />
        )}
      </div>

      {/* Coaching insight (weight correlation) */}
      {summary.coachingInsight && (
        <div className={`rounded-xl border px-3 py-2.5 text-sm ${verdictPill.bg} ${verdictPill.border}`}>
          <div className="flex items-start gap-2">
            <span>{verdictPill.icon}</span>
            <div>
              <div className={`text-[11px] font-bold uppercase tracking-wide ${verdictPill.text}`}>
                {verdictPill.label}
              </div>
              <div className="mt-0.5 text-gray-700">{summary.coachingInsight}</div>
              {signals.weightChangeKg !== null && signals.expectedWeightChangeKg !== null && (
                <div className="mt-1 text-[11px] text-gray-500 tabular-nums">
                  actual {signals.weightChangeKg >= 0 ? "+" : ""}{signals.weightChangeKg}kg · expected {signals.expectedWeightChangeKg >= 0 ? "+" : ""}{signals.expectedWeightChangeKg}kg
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {summary.highlights.length > 0 && (
        <div className="space-y-1">
          {summary.highlights.map((h, i) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              <span className="text-green-500 mt-0.5">✓</span>
              <span className="text-gray-600">{h}</span>
            </div>
          ))}
        </div>
      )}

      {summary.suggestions.length > 0 && (
        <div className="space-y-1">
          {summary.suggestions.map((s, i) => (
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

function Chip({ label, tone }: { label: string; tone: "gray" | "green" | "amber" | "red" | "orange" }) {
  const tones: Record<string, string> = {
    gray: "bg-gray-100 text-gray-600",
    green: "bg-green-50 text-green-700",
    amber: "bg-amber-50 text-amber-700",
    red: "bg-red-50 text-red-700",
    orange: "bg-orange-50 text-orange-700",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium tabular-nums ${tones[tone]}`}>
      {label}
    </span>
  );
}

function verdictPillFor(v: MonthlySignals["accuracyVerdict"]) {
  switch (v) {
    case "aligned":
      return { label: "Logging looks accurate", icon: "✅", bg: "bg-green-50", border: "border-green-200", text: "text-green-700" };
    case "under-logging-suspected":
      return { label: "Possibly under-logging", icon: "⚠️", bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700" };
    case "over-logging-suspected":
      return { label: "Weight dropped more than expected", icon: "💧", bg: "bg-blue-50", border: "border-blue-200", text: "text-blue-700" };
    default:
      return { label: "Insight", icon: "💡", bg: "bg-gray-50", border: "border-gray-200", text: "text-gray-600" };
  }
}
