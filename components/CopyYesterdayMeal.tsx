"use client";

import { useRef, useState, useTransition } from "react";
import { copyMealFromDate, undoLogBatch } from "@/app/actions/logging";
import type { LogResult } from "@/lib/meal-writes";

type YesterdayMeal = {
  mealType: string;
  label: string;
  icon: string;
  itemCount: number;
  totalKcal: number;
};

export function CopyYesterdayMeal({
  userId,
  meals,
  fromDate,
  toDate,
}: {
  userId: string;
  meals: YesterdayMeal[];
  fromDate: string;
  toDate: string;
}) {
  const [pending, startTransition] = useTransition();
  const [activeMeal, setActiveMeal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saved, setSaved] = useState<(LogResult & { label: string; expectedUserId: string }) | null>(null);
  const [failedCopy, setFailedCopy] = useState<{ meal: YesterdayMeal; fromDate: string; toDate: string; expectedUserId: string } | null>(null);
  const requestIds = useRef(new Map<string, string>());
  const inFlight = useRef(false);

  function copyMeal(meal: YesterdayMeal, sourceDate = fromDate, targetDate = toDate, expectedUserId = userId) {
    if (inFlight.current) return;
    const input = { expectedUserId, fromDate: sourceDate, toDate: targetDate, mealType: meal.mealType };
    const key = JSON.stringify(input);
    const requestId = requestIds.current.get(key) ?? crypto.randomUUID();
    requestIds.current.set(key, requestId);
    inFlight.current = true;
    setActiveMeal(meal.mealType);
    setError(null);
    setFailedCopy(null);
    startTransition(async () => {
      try {
        const result = await copyMealFromDate({ ...input, requestId });
        requestIds.current.delete(key);
        if (result.undone) {
          setSaved(null);
          setNotice("That earlier copy was undone. Tap the meal again to copy it.");
          return;
        }
        setSaved(result.entryCount > 0 ? { ...result, label: meal.label, expectedUserId } : null);
        setNotice(result.entryCount > 0
          ? `${meal.label} copied · ${result.entryCount} ${result.entryCount === 1 ? "item" : "items"} added.`
          : "No items remain in that meal to copy.");
      } catch {
        setFailedCopy({ meal, fromDate: sourceDate, toDate: targetDate, expectedUserId });
        setError(`Couldn't confirm ${meal.label.toLowerCase()} was copied. You can retry safely below.`);
      } finally {
        inFlight.current = false;
        setActiveMeal(null);
      }
    });
  }

  function undo() {
    if (!saved || inFlight.current) return;
    const previous = saved;
    inFlight.current = true;
    setError(null);
    setFailedCopy(null);
    startTransition(async () => {
      try {
        await undoLogBatch({ batchId: previous.batchId, expectedUserId: previous.expectedUserId });
        setSaved(null);
        setNotice(`${previous.label} copy removed.`);
      } catch {
        setError("Couldn't undo this copy. Try Undo again.");
      } finally {
        inFlight.current = false;
      }
    });
  }

  if (meals.length === 0 && !pending && !saved && !notice && !error) return null;

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-gray-400 uppercase tracking-wide">
        Same as yesterday?
      </div>
      <div className="flex flex-wrap gap-2">
        {meals.map((m) => (
          <button
            key={m.mealType}
            type="button"
            disabled={pending}
            onClick={() => copyMeal(m)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-brand-50 hover:text-brand-700 disabled:opacity-50 transition-all active:scale-95"
          >
            <span>{m.icon}</span>
            <span>{activeMeal === m.mealType ? "Copying…" : m.label}</span>
            <span className="text-xs text-gray-400">{Math.round(m.totalKcal)} cal</span>
          </button>
        ))}
      </div>
      {notice && (
        <div role="status" className="flex items-center gap-2 text-sm text-brand-700">
          <span>{notice}</span>
          {saved && (
            <button type="button" onClick={undo} disabled={pending} className="font-semibold underline underline-offset-2 disabled:opacity-50">
              {pending && !activeMeal ? "Undoing…" : "Undo"}
            </button>
          )}
        </div>
      )}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {error && failedCopy && (
        <button
          type="button"
          disabled={pending}
          onClick={() => copyMeal(failedCopy.meal, failedCopy.fromDate, failedCopy.toDate, failedCopy.expectedUserId)}
          className="text-sm font-semibold text-brand-700 underline underline-offset-2 disabled:opacity-50"
        >
          Retry copy
        </button>
      )}
    </div>
  );
}
