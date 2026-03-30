"use client";

import { useEffect, useState } from "react";
import { round1 } from "@/lib/nutrition";

export type MacroItem = {
  label: string;
  value: number;
  target?: number | null;
  unit: string;
  goalType: "min" | "max";
};

export function MacroBars({ macros }: { macros: MacroItem[] }) {
  const [animated, setAnimated] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setAnimated(true), 80);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="grid grid-cols-4 gap-3">
      {macros.map((m) => {
        const val = Number(m.value);
        const tgt = m.target ?? null;
        const pct = tgt ? Math.min(100, Math.round((val / tgt) * 100)) : 0;
        const diff = tgt !== null ? tgt - val : null;
        let barColor: string;
        let statusText: string | null = null;
        let statusColor: string;
        if (tgt === null) {
          barColor = "bg-gray-300";
          statusColor = "";
        } else if (m.goalType === "min") {
          barColor = val >= tgt ? "bg-green-500" : "bg-orange-400";
          statusText = diff! > 0 ? `${round1(diff!)}g left` : "✓";
          statusColor = diff! > 0 ? "text-orange-500" : "text-green-500";
        } else {
          barColor = val > tgt ? "bg-red-500" : "bg-green-500";
          statusText = diff! >= 0 ? `${round1(diff!)}g left` : `+${round1(-diff!)}g over`;
          statusColor = diff! >= 0 ? "text-gray-400" : "text-red-500";
        }
        return (
          <div key={m.label} className="text-center">
            <div className="text-xs font-bold tabular-nums text-gray-800">
              {round1(val)}{m.unit}
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ease-out ${barColor}`}
                style={{ width: animated ? `${pct}%` : "0%" }}
              />
            </div>
            <div className="mt-1 text-[10px] text-gray-400">{m.label}</div>
            {statusText && (
              <div className={`text-[9px] font-medium tabular-nums ${statusColor}`}>{statusText}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
