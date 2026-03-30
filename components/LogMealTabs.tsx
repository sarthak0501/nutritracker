"use client";

import { useState, useEffect, useTransition } from "react";
import { EstimateFromText } from "@/components/EstimateFromText";
import type { EstimateResponse } from "@/lib/llm";
import type { DayMeal } from "@/lib/day-estimate";
import { searchFoods, type FoodSearchResult } from "@/app/actions/food-search";
import { createLogEntryFromExistingFood } from "@/app/actions/logging";

const MEALS = [
  { key: "BREAKFAST", label: "Breakfast" },
  { key: "LUNCH", label: "Lunch" },
  { key: "DINNER", label: "Dinner" },
  { key: "SNACK", label: "Snacks" },
  { key: "CUSTOM", label: "Custom" },
];

type ManualStep = "search" | "log-existing" | "create-new";

export function LogMealTabs({
  date,
  onApplyEstimate,
  onApplyDay,
  manualAction,
}: {
  date: string;
  onApplyEstimate: (input: {
    date: string;
    mealType: string;
    mealName?: string;
    estimate: EstimateResponse;
    sourceText: string;
  }) => Promise<void>;
  onApplyDay: (input: {
    date: string;
    meals: DayMeal[];
    sourceText: string;
  }) => Promise<void>;
  manualAction: (formData: FormData) => Promise<void>;
}) {
  const [mode, setMode] = useState<"quick" | "fullday" | "manual">("quick");
  const [amount, setAmount] = useState(100);

  // Manual mode sub-state
  const [manualStep, setManualStep] = useState<ManualStep>("search");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<FoodSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedFood, setSelectedFood] = useState<FoodSearchResult | null>(null);
  const [existingAmount, setExistingAmount] = useState(100);
  const [existingMealType, setExistingMealType] = useState("BREAKFAST");
  const [logging, startLog] = useTransition();

  // Reset manual sub-state when switching to manual mode
  function enterManual() {
    setMode("manual");
    setManualStep("search");
    setSearchQuery("");
    setSearchResults([]);
    setSelectedFood(null);
  }

  // Debounced search
  useEffect(() => {
    if (manualStep !== "search") return;
    const timer = setTimeout(async () => {
      if (searchQuery.trim().length < 1) {
        setSearchResults([]);
        setSearching(false);
        return;
      }
      setSearching(true);
      const results = await searchFoods(searchQuery);
      setSearchResults(results);
      setSearching(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, manualStep]);

  function selectFood(food: FoodSearchResult) {
    setSelectedFood(food);
    setExistingAmount(Math.round(food.lastAmount));
    setExistingMealType(food.lastMealType);
    setManualStep("log-existing");
  }

  function handleLogExisting() {
    if (!selectedFood) return;
    startLog(async () => {
      const fd = new FormData();
      fd.set("date", date);
      fd.set("foodId", selectedFood.id);
      fd.set("mealType", existingMealType);
      fd.set("amount", String(existingAmount));
      fd.set("unit", "GRAM");
      await createLogEntryFromExistingFood(fd);
      // Reset back to search for quick re-logging
      setManualStep("search");
      setSearchQuery("");
      setSearchResults([]);
      setSelectedFood(null);
    });
  }

  return (
    <div>
      {/* Mode selector */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setMode("quick")}
          className={`flex-1 rounded-xl py-2.5 text-sm font-bold transition-all ${
            mode === "quick"
              ? "bg-brand-600 text-white shadow-sm"
              : "bg-surface-muted text-gray-500 hover:text-gray-700 hover:bg-gray-200"
          }`}
        >
          Quick meal
        </button>
        <button
          onClick={() => setMode("fullday")}
          className={`flex-1 rounded-xl py-2.5 text-sm font-bold transition-all ${
            mode === "fullday"
              ? "bg-brand-600 text-white shadow-sm"
              : "bg-surface-muted text-gray-500 hover:text-gray-700 hover:bg-gray-200"
          }`}
        >
          Full day
        </button>
        <button
          onClick={enterManual}
          className={`rounded-xl px-3 py-2.5 text-sm font-medium transition-all ${
            mode === "manual"
              ? "bg-gray-800 text-white"
              : "bg-surface-muted text-gray-400 hover:text-gray-600"
          }`}
        >
          Manual
        </button>
      </div>

      {mode === "quick" && (
        <div>
          <EstimateFromText date={date} onApply={onApplyEstimate} onApplyDay={onApplyDay} forceMode="single" />
          <div className="mt-2 text-xs text-gray-400">
            Describe a meal and I'll estimate the macros for you.
          </div>
        </div>
      )}

      {mode === "fullday" && (
        <div>
          <EstimateFromText date={date} onApply={onApplyEstimate} onApplyDay={onApplyDay} forceMode="fullday" />
          <div className="mt-2 text-xs text-gray-400">
            Type breakfast, lunch, dinner, and snacks in one message. I'll organize and estimate everything.
          </div>
        </div>
      )}

      {mode === "manual" && (
        <div className="grid gap-3">
          {/* Step 1: Search */}
          {manualStep === "search" && (
            <>
              <div className="relative">
                <input
                  autoFocus
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search foods you've logged before…"
                  className="w-full rounded-xl border-0 bg-surface-muted px-4 py-2.5 text-sm placeholder-gray-400 focus:ring-2 focus:ring-brand-500"
                />
                {searching && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">…</div>
                )}
              </div>

              {/* Search results */}
              {searchResults.length > 0 && (
                <div className="rounded-xl border border-gray-100 bg-white divide-y divide-gray-50 shadow-sm overflow-hidden">
                  {searchResults.map((food) => (
                    <button
                      key={food.id}
                      type="button"
                      onClick={() => selectFood(food)}
                      className="w-full px-4 py-3 text-left hover:bg-surface-muted transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-gray-800 truncate">
                            {food.name}
                            {food.brand && <span className="font-normal text-gray-400"> · {food.brand}</span>}
                          </div>
                          <div className="text-xs text-gray-400 mt-0.5 tabular-nums">
                            {Math.round(food.kcalPer100g)} kcal · {Math.round(food.proteinPer100g)}P {Math.round(food.carbsPer100g)}C {Math.round(food.fatPer100g)}F per 100g
                          </div>
                        </div>
                        <div className="text-xs text-gray-400 flex-shrink-0">
                          last: {Math.round(food.lastAmount)}g →
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {searchQuery.length > 0 && searchResults.length === 0 && !searching && (
                <div className="text-xs text-gray-400 text-center py-1">No matches found</div>
              )}

              {/* Divider + create new */}
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-gray-100" />
                <button
                  type="button"
                  onClick={() => setManualStep("create-new")}
                  className="text-xs font-medium text-brand-600 hover:text-brand-700 transition-colors"
                >
                  + Create new food
                </button>
                <div className="flex-1 h-px bg-gray-100" />
              </div>
            </>
          )}

          {/* Step 2a: Log existing food */}
          {manualStep === "log-existing" && selectedFood && (
            <>
              {/* Food preview */}
              <div className="rounded-xl bg-surface-muted px-4 py-3">
                <div className="text-sm font-semibold text-gray-800">
                  {selectedFood.name}
                  {selectedFood.brand && <span className="font-normal text-gray-400"> · {selectedFood.brand}</span>}
                </div>
                <div className="text-xs text-gray-400 mt-0.5 tabular-nums">
                  {Math.round(selectedFood.kcalPer100g)} kcal · {Math.round(selectedFood.proteinPer100g)}P {Math.round(selectedFood.carbsPer100g)}C {Math.round(selectedFood.fatPer100g)}F per 100g
                </div>
              </div>

              <div className="grid gap-2 grid-cols-2">
                {/* Amount stepper */}
                <label className="grid gap-1 text-sm">
                  <div className="text-xs font-medium text-gray-500">Amount (g)</div>
                  <div className="flex items-center rounded-xl bg-surface-muted overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setExistingAmount((a) => Math.max(1, a - 10))}
                      className="px-3 py-2.5 text-gray-500 hover:bg-gray-200 font-bold text-base leading-none"
                    >−</button>
                    <input
                      type="number"
                      step="1"
                      min="1"
                      value={existingAmount}
                      onChange={(e) => setExistingAmount(Math.max(1, Number(e.target.value) || 1))}
                      className="w-12 border-0 bg-transparent text-center text-sm font-semibold tabular-nums focus:outline-none focus:ring-0"
                    />
                    <button
                      type="button"
                      onClick={() => setExistingAmount((a) => a + 10)}
                      className="px-3 py-2.5 text-gray-500 hover:bg-gray-200 font-bold text-base leading-none"
                    >+</button>
                  </div>
                </label>

                {/* Meal type */}
                <label className="grid gap-1 text-sm">
                  <div className="text-xs font-medium text-gray-500">Meal</div>
                  <select
                    value={existingMealType}
                    onChange={(e) => setExistingMealType(e.target.value)}
                    className="rounded-xl border-0 bg-surface-muted px-3 py-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-brand-500"
                  >
                    {MEALS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                  </select>
                </label>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleLogExisting}
                  disabled={logging}
                  className="flex-1 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50 active:scale-[0.98] transition-all"
                >
                  {logging ? "Adding…" : "Add entry"}
                </button>
                <button
                  type="button"
                  onClick={() => setManualStep("search")}
                  className="rounded-xl bg-surface-muted px-4 py-2.5 text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors"
                >
                  ← Back
                </button>
              </div>
            </>
          )}

          {/* Step 2b: Create new food */}
          {manualStep === "create-new" && (
            <>
              <form action={manualAction} className="grid gap-3">
                <input type="hidden" name="date" value={date} />
                <div className="grid gap-2 grid-cols-2">
                  <label className="grid gap-1 text-sm">
                    <div className="text-xs font-medium text-gray-500">Meal</div>
                    <select name="mealType" className="rounded-xl border-0 bg-surface-muted px-3 py-2.5 text-sm text-gray-900 focus:ring-2 focus:ring-brand-500">
                      {MEALS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                    </select>
                  </label>
                  <label className="grid gap-1 text-sm">
                    <div className="text-xs font-medium text-gray-500">Food name</div>
                    <input name="name" required placeholder="Greek yogurt" className="rounded-xl border-0 bg-surface-muted px-3 py-2.5 text-sm placeholder-gray-400 focus:ring-2 focus:ring-brand-500" />
                  </label>
                </div>
                <div className="grid gap-2 grid-cols-2">
                  <label className="grid gap-1 text-sm">
                    <div className="text-xs font-medium text-gray-500">Amount (g)</div>
                    <div className="flex items-center rounded-xl bg-surface-muted overflow-hidden">
                      <button type="button" onClick={() => setAmount((a) => Math.max(1, a - 10))} className="px-3 py-2.5 text-gray-500 hover:bg-gray-200 font-bold text-base leading-none">−</button>
                      <input
                        name="amount"
                        type="number"
                        step="1"
                        min="1"
                        required
                        value={amount}
                        onChange={(e) => setAmount(Math.max(1, Number(e.target.value) || 1))}
                        className="w-12 border-0 bg-transparent text-center text-sm font-semibold tabular-nums focus:outline-none focus:ring-0"
                      />
                      <button type="button" onClick={() => setAmount((a) => a + 10)} className="px-3 py-2.5 text-gray-500 hover:bg-gray-200 font-bold text-base leading-none">+</button>
                    </div>
                  </label>
                  <label className="grid gap-1 text-sm">
                    <div className="text-xs font-medium text-gray-500">Calories / 100g</div>
                    <input name="kcalPer100g" type="number" step="1" required className="rounded-xl border-0 bg-surface-muted px-3 py-2.5 text-sm focus:ring-2 focus:ring-brand-500" />
                  </label>
                </div>
                <div className="grid gap-2 grid-cols-4">
                  <label className="grid gap-1 text-sm">
                    <div className="text-xs font-medium text-gray-500">Protein / 100g</div>
                    <input name="proteinPer100g" type="number" step="1" required className="rounded-xl border-0 bg-surface-muted px-3 py-2.5 text-sm focus:ring-2 focus:ring-brand-500" />
                  </label>
                  <label className="grid gap-1 text-sm">
                    <div className="text-xs font-medium text-gray-500">Carbs / 100g</div>
                    <input name="carbsPer100g" type="number" step="1" required className="rounded-xl border-0 bg-surface-muted px-3 py-2.5 text-sm focus:ring-2 focus:ring-brand-500" />
                  </label>
                  <label className="grid gap-1 text-sm">
                    <div className="text-xs font-medium text-gray-500">Fat / 100g</div>
                    <input name="fatPer100g" type="number" step="1" required className="rounded-xl border-0 bg-surface-muted px-3 py-2.5 text-sm focus:ring-2 focus:ring-brand-500" />
                  </label>
                  <label className="grid gap-1 text-sm">
                    <div className="text-xs font-medium text-gray-500">Fiber / 100g</div>
                    <input name="fiberPer100g" type="number" step="0.1" min="0" className="rounded-xl border-0 bg-surface-muted px-3 py-2.5 text-sm focus:ring-2 focus:ring-brand-500" />
                  </label>
                </div>
                <input type="hidden" name="unit" value="GRAM" />
                <div className="flex gap-2">
                  <button className="flex-1 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-700 active:scale-[0.98] transition-all">
                    Add entry
                  </button>
                  <button
                    type="button"
                    onClick={() => setManualStep("search")}
                    className="rounded-xl bg-surface-muted px-4 py-2.5 text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors"
                  >
                    ← Back
                  </button>
                </div>
              </form>
            </>
          )}
        </div>
      )}
    </div>
  );
}
