"use client";

import { useTransition } from "react";
import { copyMealFromDate } from "@/app/actions/logging";

type YesterdayMeal = {
  mealType: string;
  label: string;
  icon: string;
  itemCount: number;
  totalKcal: number;
};

export function CopyYesterdayMeal({
  meals,
  fromDate,
  toDate,
}: {
  meals: YesterdayMeal[];
  fromDate: string;
  toDate: string;
}) {
  const [pending, startTransition] = useTransition();

  if (meals.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-gray-400 uppercase tracking-wide">
        Same as yesterday?
      </div>
      <div className="flex flex-wrap gap-2">
        {meals.map((m) => (
          <button
            key={m.mealType}
            disabled={pending}
            onClick={() =>
              startTransition(() =>
                copyMealFromDate({ fromDate, toDate, mealType: m.mealType })
              )
            }
            className="inline-flex items-center gap-1.5 rounded-xl bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-brand-50 hover:text-brand-700 disabled:opacity-50 transition-all active:scale-95"
          >
            <span>{m.icon}</span>
            <span>{m.label}</span>
            <span className="text-xs text-gray-400">{Math.round(m.totalKcal)} cal</span>
          </button>
        ))}
      </div>
    </div>
  );
}
