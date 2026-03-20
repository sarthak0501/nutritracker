"use client";

import { useTransition } from "react";
import { quickLogFood } from "@/app/actions/logging";

export type FrequentFood = {
  foodId: string;
  name: string;
  count: number;
  lastAmount: number;
  lastUnit: string;
  lastMealType: string;
  kcalPer100g: number;
  proteinPer100g: number;
};

export function FrequentMeals({
  foods,
  date,
}: {
  foods: FrequentFood[];
  date: string;
}) {
  const [pending, startTransition] = useTransition();

  if (foods.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-gray-400 uppercase tracking-wide">
        Quick log
      </div>
      <div className="flex flex-wrap gap-2">
        {foods.map((f) => {
          const kcal = Math.round((f.kcalPer100g * f.lastAmount) / 100);
          const protein = Math.round((f.proteinPer100g * f.lastAmount) / 100);
          return (
            <button
              key={f.foodId}
              disabled={pending}
              onClick={() =>
                startTransition(() =>
                  quickLogFood({
                    date,
                    foodId: f.foodId,
                    amount: f.lastAmount,
                    unit: f.lastUnit,
                    mealType: f.lastMealType,
                  })
                )
              }
              className="inline-flex items-center gap-1.5 rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-700 hover:bg-brand-50 hover:text-brand-700 disabled:opacity-50 transition-all active:scale-95"
            >
              <span className="font-medium truncate max-w-[120px]">{f.name}</span>
              <span className="text-xs text-gray-400">{kcal}cal {protein}P</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
