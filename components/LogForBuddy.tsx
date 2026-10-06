"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { proposeSharedMeal } from "@/app/actions/meals";
import { MealSelectionEditor, mealControl, useMealRequestId, validMealPortion } from "@/components/MealLibrary";
import type { LibraryMeal } from "@/lib/meal-types";

type LogForBuddyProps = { userId: string; buddyId: string; buddyName: string; date: string; meals: LibraryMeal[] };

export function LogForBuddy(props: LogForBuddyProps) {
  return <LogForBuddyForAccount key={props.userId} {...props} />;
}

function LogForBuddyForAccount({ userId, buddyId, buddyName, date, meals }: LogForBuddyProps) {
  const router = useRouter();
  const selectId = useId();
  const [selectedMeal, setSelectedMeal] = useState<LibraryMeal | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [multiplier, setMultiplier] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(false);
  const attemptedProposal = useRef<Parameters<typeof proposeSharedMeal>[0] | null>(null);
  const intent = useMealRequestId();

  return (
    <div className="mt-3 space-y-3 border-t border-purple-100 pt-3">
      <div>
        <h3 className="text-sm font-bold text-gray-800">Share a meal with {buddyName}</h3>
        <p className="mt-1 text-xs text-gray-600">They choose their own portion and accept before anything goes into their log.</p>
      </div>
      {meals.length === 0 ? <p className="text-xs text-gray-500">Log a meal first, then you can propose it here. You can also share a saved meal from your shortcuts.</p> : <>
        <label htmlFor={selectId} className="block text-xs font-semibold text-gray-600">Choose one of your meals to propose</label>
        <select id={selectId} value={selectedMeal?.id ?? ""} disabled={pending || attempted} className={`${mealControl} w-full`} onChange={(event) => {
          const next = meals.find((meal) => meal.id === event.target.value) ?? null;
          setSelectedMeal(next); setSelectedIds(next?.items.map((item) => item.id) ?? []); setMultiplier("1"); setError(null); setSent(false); intent.reset(); attemptedProposal.current = null;
        }}>
          <option value="">Choose a meal</option>
          {meals.map((meal) => <option key={meal.id} value={meal.id}>{meal.name} · {meal.items.length} items</option>)}
        </select>
        {selectedMeal && !sent && <>
          <MealSelectionEditor items={selectedMeal.items} selectedIds={selectedIds} multiplier={multiplier} onSelectedChange={setSelectedIds} onMultiplierChange={setMultiplier} disabled={pending || attempted} />
          <button type="button" disabled={pending || !selectedIds.length || !validMealPortion(multiplier)} className="min-h-11 w-full rounded-xl bg-purple-600 px-4 py-2 text-sm font-bold text-white hover:bg-purple-700 focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2 disabled:opacity-50" onClick={() => {
            if (inFlight.current) return;
            const payload = { expectedUserId: userId, source: selectedMeal.source, recipientId: buddyId, name: selectedMeal.name, date, mealType: selectedMeal.mealType, selectedItemIds: selectedIds, multiplier: Number(multiplier) };
            const attempt = attemptedProposal.current ?? { ...payload, requestId: intent.forPayload(payload) };
            attemptedProposal.current = attempt;
            setAttempted(true);
            inFlight.current = true; setError(null);
            startTransition(async () => {
              try { await proposeSharedMeal(attempt); setAttempted(false); setSent(true); router.refresh(); }
              catch { setError("Couldn’t confirm the proposal. Retry with the same selections safely, or reload if you switched accounts."); }
              finally { inFlight.current = false; }
            });
          }}>{pending ? "Sending…" : attempted ? `Retry proposal to ${buddyName}` : `Propose meal to ${buddyName}`}</button>
          {attempted && !pending && <div className="space-y-2"><p className="text-xs text-gray-600">Selections are locked while this proposal waits for confirmation.</p><button type="button" className={mealControl} onClick={() => window.location.reload()}>Reload proposal status</button></div>}
        </>}
      </>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <p role="status" aria-live="polite" className="text-sm text-purple-800">{sent ? `Proposed to ${buddyName}. They can review it in Shared meals.` : null}</p>
    </div>
  );
}
