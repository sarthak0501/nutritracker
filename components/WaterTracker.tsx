"use client";

import { useTransition } from "react";
import { incrementWater, decrementWater } from "@/app/actions/water";

export function WaterTracker({ glasses, date }: { glasses: number; date: string }) {
  const [pending, startTransition] = useTransition();
  const target = 8;
  const pct = Math.min(100, Math.round((glasses / target) * 100));

  return (
    <div className="flex items-center gap-3">
      <button
        disabled={pending || glasses <= 0}
        onClick={() => startTransition(() => decrementWater(date))}
        className="rounded-xl bg-gray-100 px-3 py-2 text-sm font-bold text-gray-500 hover:bg-gray-200 disabled:opacity-30 transition-all active:scale-95"
      >
        −
      </button>

      <div className="flex-1">
        <div className="flex items-baseline justify-between mb-1">
          <span className="text-sm font-semibold text-gray-700">
            💧 {glasses} / {target} glasses
          </span>
          {glasses >= target && (
            <span className="text-xs font-medium text-green-500">✓</span>
          )}
        </div>
        <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              glasses >= target ? "bg-blue-500" : "bg-blue-300"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <button
        disabled={pending}
        onClick={() => startTransition(() => incrementWater(date))}
        className="rounded-xl bg-blue-50 px-3 py-2 text-sm font-bold text-blue-600 hover:bg-blue-100 disabled:opacity-50 transition-all active:scale-95"
      >
        +
      </button>
    </div>
  );
}
