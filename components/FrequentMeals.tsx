"use client";

import { useRef, useState, useTransition } from "react";
import { quickLogFood, undoLogBatch } from "@/app/actions/logging";
import type { LogResult } from "@/lib/meal-writes";

export type FrequentFood = {
  foodId: string;
  name: string;
  count: number;
  lastAmount: number;
  lastUnit: string;
  lastMealType: string;
  kcalPer100g: number;
  proteinPer100g: number;
  servingGrams?: number | null;
  sourceEntryId?: string;
  isLegacyPortion?: boolean;
  portionLabel?: string;
  lastNutrients?: { kcal: number; protein_g: number } | null;
};

export function FrequentMeals({
  userId,
  foods,
  date,
}: {
  userId: string;
  foods: FrequentFood[];
  date: string;
}) {
  const [pending, startTransition] = useTransition();
  const [activeFood, setActiveFood] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState<(LogResult & { name: string; expectedUserId: string }) | null>(null);
  const [failedSave, setFailedSave] = useState<{ food: FrequentFood; date: string; expectedUserId: string } | null>(null);
  const attempts = useRef(new Map<string, {
    requestId: string;
    input: Parameters<typeof quickLogFood>[0] & { expectedUserId: string };
  }>());
  const inFlight = useRef(false);

  function logFood(food: FrequentFood, logDate = date, expectedUserId = userId) {
    if (inFlight.current) return;
    const key = `${logDate}:${food.foodId}`;
    const previousAttempt = attempts.current.get(key);
    const input = previousAttempt?.input ?? {
      expectedUserId,
      date: logDate,
      foodId: food.foodId,
      amount: food.lastAmount,
      unit: food.lastUnit,
      mealType: food.lastMealType,
      sourceEntryId: food.sourceEntryId,
      portionMultiplier: food.isLegacyPortion ? 1 : undefined,
    };
    const requestId = previousAttempt?.requestId ?? crypto.randomUUID();
    attempts.current.set(key, { input, requestId });
    inFlight.current = true;
    setActiveFood(food.foodId);
    setError(null);
    setFailedSave(null);
    startTransition(async () => {
      try {
        const result = await quickLogFood({ ...input, requestId });
        attempts.current.delete(key);
        if (result.undone) {
          setSaved(null);
          setNotice("That earlier save was undone. Tap the meal again to add it.");
          return;
        }
        setSaved({ ...result, name: food.name, expectedUserId: input.expectedUserId });
        setNotice(`${food.name} added.`);
      } catch {
        setFailedSave({ food, date: logDate, expectedUserId: input.expectedUserId });
        setError(`Couldn't confirm ${food.name} was added. You can retry safely below.`);
      } finally {
        inFlight.current = false;
        setActiveFood(null);
      }
    });
  }

  function undo() {
    if (!saved || inFlight.current) return;
    const previous = saved;
    inFlight.current = true;
    setError(null);
    setFailedSave(null);
    startTransition(async () => {
      try {
        await undoLogBatch({ batchId: previous.batchId, expectedUserId: previous.expectedUserId });
        setSaved(null);
        setNotice(`${previous.name} removed.`);
      } catch {
        setError("Couldn't undo this save. Try Undo again.");
      } finally {
        inFlight.current = false;
      }
    });
  }

  if (foods.length === 0 && !pending && !saved && !notice && !error) return null;

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-gray-400 uppercase tracking-wide">
        Quick log
      </div>
      <div className="flex flex-wrap gap-2">
        {foods.map((f) => {
          const grams = f.isLegacyPortion ? null : f.lastUnit === "GRAM"
            ? f.lastAmount
            : f.lastUnit === "SERVING" && f.servingGrams && f.servingGrams > 0
              ? f.lastAmount * f.servingGrams
              : null;
          const portion = f.isLegacyPortion ? (f.portionLabel ?? "Logged portion") : f.lastUnit === "GRAM"
            ? `${f.lastAmount} g`
            : `${f.lastAmount} ${f.lastAmount === 1 ? "serving" : "servings"}`;
          const nutrients = f.sourceEntryId && f.lastNutrients
            ? `${Math.round(f.lastNutrients.kcal)} cal · ${Math.round(f.lastNutrients.protein_g)}P`
            : grams === null
            ? "Nutrition unavailable"
            : `${Math.round((f.kcalPer100g * grams) / 100)} cal · ${Math.round((f.proteinPer100g * grams) / 100)}P`;
          return (
            <button
              key={f.foodId}
              type="button"
              disabled={pending}
              onClick={() => logFood(f)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-700 hover:bg-brand-50 hover:text-brand-700 disabled:opacity-50 transition-all active:scale-95"
            >
              <span className="font-medium truncate max-w-[120px]">{f.name}</span>
              <span className="text-xs text-gray-500">
                {activeFood === f.foodId ? "Saving…" : `${portion} · ${nutrients}`}
              </span>
            </button>
          );
        })}
      </div>
      {notice && (
        <div role="status" className="flex items-center gap-2 text-sm text-brand-700">
          <span>{notice}</span>
          {saved && saved.entryCount > 0 && (
            <button type="button" onClick={undo} disabled={pending} className="font-semibold underline underline-offset-2 disabled:opacity-50">
              {pending && !activeFood ? "Undoing…" : "Undo"}
            </button>
          )}
        </div>
      )}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {error && failedSave && (
        <button
          type="button"
          disabled={pending}
          onClick={() => logFood(failedSave.food, failedSave.date, failedSave.expectedUserId)}
          className="text-sm font-semibold text-brand-700 underline underline-offset-2 disabled:opacity-50"
        >
          Retry save
        </button>
      )}
    </div>
  );
}
