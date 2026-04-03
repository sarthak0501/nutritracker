"use client";

import { useTransition } from "react";
import { updateTheme } from "@/app/actions/profile";

const THEMES = [
  {
    key: "light",
    label: "Light",
    description: "Clean & fresh",
    swatch: ["#16a34a", "#22c55e", "#f5f5f0"],
  },
  {
    key: "puppy",
    label: "Puppy 🐾",
    description: "Warm & playful",
    swatch: ["#d97706", "#fbbf24", "#fef9ee"],
  },
  {
    key: "love",
    label: "Love 💕",
    description: "Soft & romantic",
    swatch: ["#db2777", "#f472b6", "#fdf2f8"],
  },
  {
    key: "motivation",
    label: "Motivation 💪",
    description: "Bold & electric",
    swatch: ["#7c3aed", "#a78bfa", "#f5f3ff"],
  },
];

export function ThemePicker({ current }: { current: string }) {
  const [pending, startTransition] = useTransition();

  function pick(key: string) {
    if (key === current) return;
    startTransition(async () => {
      await updateTheme(key);
    });
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      {THEMES.map(({ key, label, description, swatch }) => {
        const active = current === key;
        return (
          <button
            key={key}
            onClick={() => pick(key)}
            disabled={pending}
            className={`rounded-2xl border-2 p-3 text-left transition-all disabled:opacity-60 ${
              active
                ? "border-brand-500 bg-brand-50 shadow-sm"
                : "border-gray-100 bg-surface-muted hover:border-gray-200"
            }`}
          >
            {/* Swatch dots */}
            <div className="flex gap-1.5 mb-2">
              {swatch.map((color, i) => (
                <span
                  key={i}
                  className="w-5 h-5 rounded-full shadow-sm"
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
            <div className="text-sm font-bold text-gray-800">{label}</div>
            <div className="text-xs text-gray-400 mt-0.5">{description}</div>
            {active && (
              <div className="mt-1.5 text-[10px] font-bold uppercase tracking-wide text-brand-600">Active</div>
            )}
          </button>
        );
      })}
    </div>
  );
}
