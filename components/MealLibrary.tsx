"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/Card";
import { deleteMealPreset, logLibraryMeal, proposeSharedMeal, saveMealPreset, updateMealPreset } from "@/app/actions/meals";
import { undoLogBatch } from "@/app/actions/logging";
import type { LibraryMeal, MealItem, MealLibraryData } from "@/lib/meal-types";

export const MEAL_OPTIONS = [
  { value: "BREAKFAST", label: "Breakfast" },
  { value: "LUNCH", label: "Lunch" },
  { value: "DINNER", label: "Dinner" },
  { value: "SNACK", label: "Snack" },
  { value: "CUSTOM", label: "Other" },
] as const;
type MealType = typeof MEAL_OPTIONS[number]["value"];
export const mealControl = "min-h-11 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50";
export const mealPrimary = "min-h-11 rounded-xl bg-brand-600 px-4 py-2 text-sm font-bold text-white hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:opacity-50";

/** One key per reviewed intent: retries keep the key; changed inputs create a new one. */
export function useMealRequestId() {
  const intent = useRef<{ payload: string; requestId: string } | null>(null);
  return {
    forPayload(payload: unknown) {
      const serialized = JSON.stringify(payload);
      if (intent.current?.payload !== serialized) {
        intent.current = { payload: serialized, requestId: crypto.randomUUID() };
      }
      return intent.current!.requestId;
    },
    reset() { intent.current = null; },
  };
}

export function validMealPortion(value: string) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0.25 && amount <= 4;
}

export function MealSelectionEditor({ items, selectedIds, multiplier, onSelectedChange, onMultiplierChange, disabled = false }: {
  items: MealItem[];
  selectedIds: string[];
  multiplier: string;
  onSelectedChange: (ids: string[]) => void;
  onMultiplierChange: (value: string) => void;
  disabled?: boolean;
}) {
  const portionId = useId();
  const factor = validMealPortion(multiplier) ? Number(multiplier) : 0;
  const selected = items.filter((item) => selectedIds.includes(item.id));
  const kcal = Math.round(selected.reduce((sum, item) => sum + item.nutrients.kcal, 0) * factor);
  const protein = Math.round(selected.reduce((sum, item) => sum + item.nutrients.protein_g, 0) * factor);

  return (
    <fieldset disabled={disabled} className="space-y-3">
      <legend className="mb-1 text-sm font-semibold text-gray-700">Choose your items</legend>
      <div className="space-y-1">
        {items.map((item) => (
          <label key={item.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl bg-white/80 p-3">
            <input
              type="checkbox"
              checked={selectedIds.includes(item.id)}
              onChange={(event) => onSelectedChange(event.target.checked ? [...selectedIds, item.id] : selectedIds.filter((id) => id !== item.id))}
              className="h-5 w-5 shrink-0 accent-brand-600 focus-visible:ring-2 focus-visible:ring-brand-500"
            />
            <span className="min-w-0 flex-1">
              <span className="block break-words text-sm font-medium text-gray-800">{item.name}</span>
              <span className="block text-xs text-gray-500">{item.portionLabel}{item.isEstimated ? " · estimated" : ""}</span>
            </span>
            <span className="shrink-0 text-xs tabular-nums text-gray-600">{Math.round(item.nutrients.kcal)} kcal</span>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <label htmlFor={portionId} className="mb-1 block text-xs font-semibold text-gray-600">Your portion ×</label>
          <input id={portionId} type="number" inputMode="decimal" min="0.25" max="4" step="any" value={multiplier} onChange={(event) => onMultiplierChange(event.target.value)} className={`${mealControl} w-24`} aria-describedby={`${portionId}-hint`} />
        </div>
        <div className="text-right text-sm font-semibold tabular-nums text-brand-700" aria-live="polite">{kcal} kcal <span className="block text-xs font-normal text-gray-600">{protein}g protein · {selected.length} items</span></div>
      </div>
      <p id={`${portionId}-hint`} className="text-xs text-gray-500">1 = the portions shown above. Use 0.5 for half, or 1.5 for more. Adjusts every selected item.</p>
      {!validMealPortion(multiplier) && <p className="text-xs text-red-700">Enter a portion between 0.25 and 4.</p>}
    </fieldset>
  );
}

type MealLibraryProps = {
  userId: string;
  date: string;
  saved: LibraryMeal[];
  recent: LibraryMeal[];
  buddy: MealLibraryData["buddy"];
};

export function MealLibrary(props: MealLibraryProps) {
  return <MealLibraryForAccount key={props.userId} {...props} />;
}

function MealLibraryForAccount({ userId, date, saved, recent, buddy }: MealLibraryProps) {
  const router = useRouter();
  const titleId = useId();
  const [selectedMeal, setSelectedMeal] = useState<LibraryMeal | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [multiplier, setMultiplier] = useState("1");
  const [mealType, setMealType] = useState<MealType>("LUNCH");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [logged, setLogged] = useState(false);
  const [proposed, setProposed] = useState(false);
  const [presetSaved, setPresetSaved] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [retryAction, setRetryAction] = useState<"log" | "share" | "preset" | null>(null);
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(false);
  const attemptedLog = useRef<Parameters<typeof logLibraryMeal>[0] | null>(null);
  const attemptedShare = useRef<Parameters<typeof proposeSharedMeal>[0] | null>(null);
  const attemptedPreset = useRef<Parameters<typeof saveMealPreset>[0] | null>(null);
  const logIntent = useMealRequestId();
  const shareIntent = useMealRequestId();
  const presetIntent = useMealRequestId();
  const canSave = selectedIds.length > 0 && validMealPortion(multiplier);
  const reviewLocked = pending || retryAction !== null;
  const sortedSaved = [...saved].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));

  function choose(meal: LibraryMeal) {
    if (inFlight.current || retryAction) return;
    setSelectedMeal(meal);
    setSelectedIds(meal.items.map((item) => item.id));
    setMultiplier("1");
    setMealType(meal.mealType as MealType);
    setName(meal.name);
    setError(null);
    setMessage(null);
    setLogged(false);
    setProposed(false);
    setPresetSaved(false);
    logIntent.reset();
    shareIntent.reset();
    presetIntent.reset();
    attemptedLog.current = null;
    attemptedShare.current = null;
    attemptedPreset.current = null;
  }

  function closeReview() {
    if (inFlight.current) return;
    if (retryAction && !window.confirm("This attempt may already have been saved. Close this review? Check your history, saved meals, or sent proposals before trying to add it again.")) return;
    setSelectedMeal(null);
    setRetryAction(null);
    setError(null);
  }

  function run(action: () => Promise<void>, failure: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    startTransition(async () => {
      try { await action(); }
      catch { setError(`${failure} If you switched accounts, reload this page.`); }
      finally { inFlight.current = false; }
    });
  }

  function log() {
    if (!selectedMeal || !canSave || logged || inFlight.current || (retryAction && retryAction !== "log")) return;
    const payload = { expectedUserId: userId, source: selectedMeal.source, date, mealType, multiplier: Number(multiplier), selectedItemIds: selectedIds };
    const attempt = attemptedLog.current ?? { ...payload, requestId: logIntent.forPayload(payload) };
    attemptedLog.current = attempt;
    setRetryAction("log");
    run(async () => {
      const result = await logLibraryMeal(attempt);
      setRetryAction(null);
      if (result.undone) {
        setSelectedMeal(null);
        setBatchId(null);
        setMessage("That save was already undone. Choose a meal again to start a new save.");
        router.refresh();
        return;
      }
      setBatchId(result.batchId);
      setLogged(true);
      setMessage(`${result.entryCount} item${result.entryCount === 1 ? "" : "s"} saved to your ${attempt.mealType.toLowerCase()}.`);
      router.refresh();
    }, "Couldn’t confirm the save. Retry with the same selections; this won’t add duplicates.");
  }

  function share() {
    if (!selectedMeal || !buddy || !canSave || proposed || inFlight.current || (retryAction && retryAction !== "share")) return;
    const payload = { expectedUserId: userId, source: selectedMeal.source, recipientId: buddy.id, name: name.trim() || selectedMeal.name, date, mealType, selectedItemIds: selectedIds, multiplier: Number(multiplier) };
    const attempt = attemptedShare.current ?? { ...payload, requestId: shareIntent.forPayload(payload) };
    attemptedShare.current = attempt;
    setRetryAction("share");
    run(async () => {
      await proposeSharedMeal(attempt);
      setRetryAction(null);
      setProposed(true);
      setMessage(`Meal proposed to ${buddy.username}. They choose their portion and accept before anything is logged.`);
      router.refresh();
    }, "Couldn’t confirm the proposal. Retry with the same selections safely.");
  }

  function savePreset() {
    if (!selectedMeal || !canSave || !name.trim() || presetSaved || inFlight.current || (retryAction && retryAction !== "preset")) return;
    const payload = { expectedUserId: userId, name: name.trim(), source: selectedMeal.source, selectedItemIds: selectedIds, multiplier: Number(multiplier) };
    const attempt = attemptedPreset.current ?? { ...payload, requestId: presetIntent.forPayload(payload) };
    attemptedPreset.current = attempt;
    setRetryAction("preset");
    run(async () => {
      await saveMealPreset(attempt);
      setRetryAction(null);
      setPresetSaved(true);
      setMessage(`“${attempt.name}” saved as a pinned meal.`);
      router.refresh();
    }, "Couldn’t confirm the shortcut save. Retry with the same selections safely.");
  }

  return (
    <Card variant="action">
      <section aria-labelledby={titleId} className="space-y-4">
        <div>
          <h2 id={titleId} className="text-lg font-bold text-gray-900">Your meal shortcuts</h2>
          <p className="mt-1 text-xs text-gray-500">Repeat a meal, adjust your portion, and get on with your day.</p>
        </div>
        {saved.length === 0 && recent.length === 0 ? <p className="rounded-xl bg-white/70 p-3 text-sm text-gray-600">Log your first meal below. It will appear here, ready to repeat or pin with a name.</p> : (
          <div className="space-y-3">
            {sortedSaved.length > 0 && <div>
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">Saved meals</h3>
              <div className="flex flex-wrap gap-2">{sortedSaved.map((meal) => <button key={meal.id} type="button" onClick={() => choose(meal)} disabled={reviewLocked} aria-pressed={selectedMeal?.id === meal.id} className={`${mealControl} max-w-full text-left hover:border-brand-300 hover:bg-brand-50`}><span className="break-words font-semibold">{meal.pinned ? "★ " : ""}{meal.name}</span><span className="block text-xs text-gray-500">{meal.items.length} items · {Math.round(meal.items.reduce((sum, item) => sum + item.nutrients.kcal, 0))} kcal</span></button>)}</div>
            </div>}
            {recent.length > 0 && <div>
              <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">Recent meals</h3>
              <div className="flex flex-wrap gap-2">{(showMore ? recent : recent.slice(0, 3)).map((meal, index) => <button key={meal.id} type="button" onClick={() => choose(meal)} disabled={reviewLocked} aria-pressed={selectedMeal?.id === meal.id} className={`${mealControl} max-w-full text-left hover:border-brand-300 hover:bg-brand-50`}><span className="break-words font-semibold">{index === 0 ? "↻ Repeat last meal" : meal.name}</span><span className="block text-xs text-gray-500">{meal.date} · {meal.items.length} items · {Math.round(meal.items.reduce((sum, item) => sum + item.nutrients.kcal, 0))} kcal</span></button>)}</div>
              {recent.length > 3 && <button type="button" className="mt-1 min-h-11 rounded-lg px-2 text-xs font-semibold text-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500" onClick={() => setShowMore(!showMore)}>{showMore ? "Show fewer" : "More recent meals"}</button>}
            </div>}
          </div>
        )}
        {selectedMeal && <div className="space-y-3 rounded-2xl border border-brand-100 bg-brand-50/50 p-3 sm:p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="min-w-0 flex-1 break-words text-sm font-bold text-gray-800">{selectedMeal.name}</h3>
            <button type="button" disabled={pending} className={`${mealControl} shrink-0`} onClick={closeReview} aria-label="Close meal review">Close</button>
          </div>
          {!logged ? <>
            <MealSelectionEditor items={selectedMeal.items} selectedIds={selectedIds} multiplier={multiplier} onSelectedChange={setSelectedIds} onMultiplierChange={setMultiplier} disabled={reviewLocked} />
            <label className="block text-xs font-semibold text-gray-600">Save to your {date} log
              <select value={mealType} onChange={(event) => setMealType(event.target.value as MealType)} disabled={reviewLocked} className={`${mealControl} mt-1 block w-full`}>{MEAL_OPTIONS.map((meal) => <option key={meal.value} value={meal.value}>{meal.label}</option>)}</select>
            </label>
            <button type="button" disabled={pending || !canSave || (retryAction !== null && retryAction !== "log")} onClick={log} className={`${mealPrimary} w-full`}>{pending ? "Working…" : retryAction === "log" ? "Retry save safely" : "Save to my log"}</button>
          </> : <p className="text-sm font-semibold text-brand-700">✓ Saved. Choose another meal above when you’re ready.</p>}
          <details className="border-t border-brand-100 pt-2">
            <summary className="flex min-h-11 cursor-pointer items-center rounded-lg text-sm font-semibold text-gray-700 focus-visible:ring-2 focus-visible:ring-brand-500">Save a shortcut or share this meal</summary>
            <div className="space-y-3 pt-2">
              <label className="block text-xs font-semibold text-gray-600">Meal name
                <input value={name} onChange={(event) => setName(event.target.value)} disabled={reviewLocked} maxLength={80} placeholder="e.g. Our usual dal and roti" className={`${mealControl} mt-1 block w-full`} />
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={mealControl} disabled={pending || !canSave || !name.trim() || presetSaved || (retryAction !== null && retryAction !== "preset")} onClick={savePreset}>{presetSaved ? "✓ Shortcut saved" : retryAction === "preset" ? "Retry shortcut safely" : "★ Save as pinned meal"}</button>
                {buddy && <button type="button" className={`${mealControl} border-purple-200 text-purple-700`} disabled={pending || !canSave || proposed || (retryAction !== null && retryAction !== "share")} onClick={share}>{proposed ? `✓ Proposed to ${buddy.username}` : retryAction === "share" ? `Retry proposal to ${buddy.username}` : `Propose to ${buddy.username}`}</button>}
              </div>
              {buddy && <p className="text-xs text-gray-500">{buddy.username} reviews the proposal and chooses their own portion. Sending it does not change their log.</p>}
              {selectedMeal.source.kind === "saved" && <div className="flex flex-wrap gap-2 border-t border-brand-100 pt-3">
                <button type="button" className={mealControl} disabled={reviewLocked || !name.trim()} onClick={() => run(async () => {
                  await updateMealPreset({ expectedUserId: userId, id: selectedMeal.source.kind === "saved" ? selectedMeal.source.id : selectedMeal.id, name: name.trim() });
                  setSelectedMeal({ ...selectedMeal, name: name.trim() });
                  setMessage("Meal renamed."); router.refresh();
                }, "Couldn’t rename the meal. Please try again.")}>Rename</button>
                <button type="button" className={mealControl} disabled={reviewLocked} onClick={() => run(async () => {
                  await updateMealPreset({ expectedUserId: userId, id: selectedMeal.source.kind === "saved" ? selectedMeal.source.id : selectedMeal.id, pinned: !selectedMeal.pinned });
                  setSelectedMeal({ ...selectedMeal, pinned: !selectedMeal.pinned });
                  setMessage(selectedMeal.pinned ? "Meal unpinned. It stays in your saved meals." : "Meal pinned."); router.refresh();
                }, "Couldn’t change the pin. Please try again.")}>{selectedMeal.pinned ? "Unpin" : "Pin"}</button>
                <button type="button" className={`${mealControl} text-red-700`} disabled={reviewLocked} onClick={() => run(async () => {
                  await deleteMealPreset({ expectedUserId: userId, id: selectedMeal.source.kind === "saved" ? selectedMeal.source.id : selectedMeal.id });
                  setSelectedMeal(null); setMessage("Shortcut removed. Your logged meals are unchanged."); router.refresh();
                }, "Couldn’t remove the shortcut. Please try again.")}>Remove shortcut</button>
              </div>}
            </div>
          </details>
        </div>}
        {retryAction && !pending && <p className="text-xs text-gray-600">This attempt is waiting for confirmation. Your selections are locked so Retry checks the same request. Close the review only if you want to leave this attempt.</p>}
        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <div role="status" aria-live="polite" className="text-sm text-brand-800">{message}</div>
        {batchId && <button type="button" disabled={reviewLocked} className={mealControl} onClick={() => run(async () => {
          await undoLogBatch({ batchId, expectedUserId: userId });
          setBatchId(null); setSelectedMeal(null); setLogged(false); setMessage("Save undone. Those items were removed from your log."); router.refresh();
        }, "Couldn’t undo the save. Please try again.")}>Undo last save</button>}
      </section>
    </Card>
  );
}
