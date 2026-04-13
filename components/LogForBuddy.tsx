"use client";

import { useState, useTransition } from "react";
import type { EstimateResponse } from "@/lib/llm";
import { copyMealsToBuddy, applyEstimatedMealForBuddy } from "@/app/actions/logging";

const MEALS = [
  { key: "BREAKFAST", label: "🌅 Breakfast" },
  { key: "LUNCH", label: "☀️ Lunch" },
  { key: "DINNER", label: "🌙 Dinner" },
  { key: "SNACK", label: "🍎 Snacks" },
];

export type UserMealSummary = {
  mealType: string;
  label: string;
  icon: string;
  itemCount: number;
  kcal: number;
};

export function LogForBuddy({
  buddyName,
  date,
  userMeals,
}: {
  buddyName: string;
  date: string;
  userMeals: UserMealSummary[];
}) {
  const [text, setText] = useState("");
  const [mealType, setMealType] = useState("LUNCH");
  const [copying, startCopy] = useTransition();
  const [logging, startLog] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  function handleCopyMealType(mt: string) {
    startCopy(async () => {
      await copyMealsToBuddy({ date, mealType: mt });
      showToast(`Copied to ${buddyName}`);
    });
  }

  function handleCopyAll() {
    startCopy(async () => {
      await copyMealsToBuddy({ date });
      showToast(`All meals copied to ${buddyName}`);
    });
  }

  function handleLogForBuddy() {
    if (!text.trim()) return;
    setError(null);
    startLog(async () => {
      try {
        const res = await fetch("/api/estimate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: text.trim() }),
        });
        if (!res.ok) throw new Error("Estimation failed");
        const estimate: EstimateResponse = await res.json();
        await applyEstimatedMealForBuddy({ date, mealType, estimate, sourceText: text.trim() });
        setText("");
        showToast(`Logged for ${buddyName}`);
      } catch {
        setError("Failed to log — try again");
      }
    });
  }

  return (
    <div className="mt-3 pt-3 border-t border-white/40 space-y-3">
      <div className="text-xs font-bold text-gray-500 uppercase tracking-wide">Log for {buddyName}</div>

      {/* Copy my meals */}
      {userMeals.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs text-gray-500">Copy your meals:</div>
          <div className="flex flex-wrap gap-2">
            {userMeals.map((m) => (
              <button
                key={m.mealType}
                type="button"
                onClick={() => handleCopyMealType(m.mealType)}
                disabled={copying || logging}
                className="inline-flex items-center gap-1.5 rounded-xl bg-white/80 border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-white disabled:opacity-50 transition-colors shadow-sm"
              >
                <span>{m.icon}</span>
                <span>{m.label}</span>
                <span className="text-gray-400 tabular-nums">{Math.round(m.kcal)} kcal</span>
              </button>
            ))}
            {userMeals.length > 1 && (
              <button
                type="button"
                onClick={handleCopyAll}
                disabled={copying || logging}
                className="inline-flex items-center gap-1 rounded-xl bg-purple-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-purple-700 disabled:opacity-50 transition-colors"
              >
                Copy all
              </button>
            )}
          </div>
        </div>
      )}

      {/* Log a different meal */}
      <div className="space-y-1.5">
        <div className="text-xs text-gray-500">Log something different:</div>
        <div className="flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !logging && handleLogForBuddy()}
            placeholder={`What did ${buddyName} eat?`}
            className="flex-1 min-w-0 rounded-xl border-0 bg-white/80 px-3 py-2 text-sm placeholder-gray-400 focus:ring-2 focus:ring-purple-400 shadow-sm"
          />
          <select
            value={mealType}
            onChange={(e) => setMealType(e.target.value)}
            className="rounded-xl border-0 bg-white/80 px-2 py-2 text-xs text-gray-700 focus:ring-2 focus:ring-purple-400 shadow-sm flex-shrink-0"
          >
            {MEALS.map((m) => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleLogForBuddy}
            disabled={logging || copying || !text.trim()}
            className="rounded-xl bg-purple-600 px-3 py-2 text-xs font-bold text-white hover:bg-purple-700 disabled:opacity-50 transition-all active:scale-95 flex-shrink-0"
          >
            {logging ? "…" : "Log"}
          </button>
        </div>
      </div>

      {error && <div className="text-xs text-red-500">{error}</div>}
      {toast && (
        <div className="inline-flex items-center gap-1 rounded-full bg-green-50 border border-green-200 px-3 py-1 text-xs font-medium text-green-700">
          ✓ {toast}
        </div>
      )}
    </div>
  );
}
