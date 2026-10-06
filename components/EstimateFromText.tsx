"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import type { EstimateResponse } from "@/lib/llm";
import type { DayMeal, DayEstimateResponse } from "@/lib/day-estimate";
import type { LogResult } from "@/lib/meal-writes";
import { undoLogBatch } from "@/app/actions/logging";
import { DraftPrivacy } from "@/components/DraftPrivacy";
import { DRAFTS_CLEARED_EVENT, MealDraftSchema, emptyMealDraft, pruneMealDrafts, readScopedDraft, removeScopedDraft, scaleEstimatedItem, writeScopedDraft, type DraftScope, type MealDraft } from "@/lib/drafts";

export type EstimateFromTextProps = {
  date: string;
  userId: string;
  defaultMealType?: string;
  forceMode?: "single" | "fullday";
  onApply: (input: { date: string; mealType: string; mealName?: string; estimate: EstimateResponse; sourceText: string; requestId?: string; expectedUserId: string }) => Promise<LogResult>;
  onApplyDay: (input: { date: string; meals: DayMeal[]; sourceText: string; requestId?: string; expectedUserId: string }) => Promise<LogResult>;
};

const MEALS = [
  { key: "BREAKFAST", label: "Breakfast" }, { key: "LUNCH", label: "Lunch" },
  { key: "DINNER", label: "Dinner" }, { key: "SNACK", label: "Snacks" }, { key: "CUSTOM", label: "Custom" },
] as const;
const inputClass = "w-full rounded-xl border-0 bg-surface-muted px-3 py-2.5 text-base text-gray-900 focus:ring-2 focus:ring-brand-500";
const actionClass = "min-h-11 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50";

type ReviewedItem = EstimateResponse["items"][number];
function ReviewItem({ item, onQuantity, onRemove }: { item: ReviewedItem; onQuantity: (quantity: number) => void; onRemove: () => void }) {
  const [quantity, setQuantity] = useState(String(item.quantity));
  useEffect(() => setQuantity(String(item.quantity)), [item.quantity]);
  return <div className="space-y-2 rounded-xl bg-surface-muted p-3">
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0 text-sm font-semibold text-gray-800">{item.description}</div>
      <button type="button" onClick={onRemove} aria-label={`Remove ${item.description}`} className="min-h-11 shrink-0 rounded-lg px-3 text-sm font-medium text-red-600 hover:bg-red-50">Remove</button>
    </div>
    <label className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
      <span>Quantity ({item.unit || "portion"})</span>
      <input aria-label={`Quantity for ${item.description}`} type="number" inputMode="decimal" required min="0.01" max="1000000" step="any" value={quantity}
        onChange={(e) => { setQuantity(e.target.value); const amount = Number(e.target.value); if (Number.isFinite(amount) && amount > 0 && amount <= 1_000_000) onQuantity(amount); }}
        className="w-28 rounded-lg border border-gray-200 bg-white px-3 py-2 text-base" />
    </label>
    <div className="text-sm tabular-nums text-gray-700">{Math.round(item.nutrients.kcal)} kcal · {item.nutrients.protein_g.toFixed(1)}P · {item.nutrients.carbs_g.toFixed(1)}C · {item.nutrients.fat_g.toFixed(1)}F</div>
    <div className="text-xs text-gray-500">Estimated · {Math.round(item.confidence * 100)}% confidence. Changing the quantity scales this estimate.</div>
    {item.assumptions.length > 0 && <p className="text-xs text-gray-500">{item.assumptions.join(" · ")}</p>}
  </div>;
}

// Remount when scope changes: old account/date/mode state is never rendered under a new scope.
export function EstimateFromText(props: EstimateFromTextProps) {
  return <EstimateComposer key={`${props.userId ?? "no-drafts"}:${props.date}:${props.forceMode ?? "single"}`} {...props} />;
}

function EstimateComposer({ date, userId, defaultMealType = "DINNER", forceMode = "single", onApply, onApplyDay }: EstimateFromTextProps) {
  const initialMealType = MEALS.find((meal) => meal.key === defaultMealType)?.key ?? "DINNER";
  const [draft, setDraft] = useState<MealDraft>(() => emptyMealDraft(initialMealType));
  const [ready, setReady] = useState(false);
  const [storageAvailable, setStorageAvailable] = useState(Boolean(userId));
  const [restored, setRestored] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<LogResult | null>(null);
  const [successNote, setSuccessNote] = useState("");
  const [isPending, startEstimate] = useTransition();
  const [isApplying, startApply] = useTransition();
  const [isUndoing, startUndo] = useTransition();
  const lastStored = useRef("");
  const saving = useRef(false);
  const estimating = useRef(false);
  const scope: DraftScope = { userId: userId ?? "", date, mode: forceMode };
  const isFullDay = forceMode === "fullday";

  useEffect(() => {
    if (userId) pruneMealDrafts(userId);
    const saved = userId ? readScopedDraft(scope, (value) => { const parsed = MealDraftSchema.safeParse(value); return parsed.success ? parsed.data : null; }) : null;
    const next = saved ?? emptyMealDraft(initialMealType);
    lastStored.current = JSON.stringify(next);
    setDraft(next);
    setRestored(Boolean(saved));
    try { setStorageAvailable(Boolean(userId && window.localStorage)); } catch { setStorageAvailable(false); }
    setReady(true);
    const cleared = () => { setDraft(emptyMealDraft(initialMealType)); setReady(false); };
    window.addEventListener(DRAFTS_CLEARED_EVENT, cleared);
    return () => window.removeEventListener(DRAFTS_CLEARED_EVENT, cleared);
    // This component is keyed by scope. Hydrate once before enabling editing or persistence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ready || !userId) return;
    const serialized = JSON.stringify(draft);
    if (serialized === lastStored.current) return;
    lastStored.current = serialized;
    if (!draft.text && !draft.result && !draft.hasDayResult) removeScopedDraft(scope);
    else setStorageAvailable(writeScopedDraft(scope, draft));
    // Scope is fixed for this keyed instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, ready, userId]);

  function update(patch: Partial<MealDraft>) { setDraft((previous) => ({ ...previous, ...patch })); setError(null); }
  function discard() {
    if (draft.requestId && !window.confirm("A save may already have reached your account. Discard this draft? Check your history before adding it again.")) return;
    removeScopedDraft(scope);
    setDraft(emptyMealDraft(initialMealType));
    setRestored(false);
    setError(null);
  }

  function estimate() {
    if (estimating.current) return;
    estimating.current = true;
    setError(null);
    setSuccess(null);
    startEstimate(async () => {
      try {
        const response = await fetch(isFullDay ? "/api/estimate-day" : "/api/estimate", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: draft.text }),
        });
        if (!response.ok) { setError("Could not estimate this meal. Your text is kept; try again or use saved foods / manual entry."); return; }
        if (isFullDay) {
          const result: DayEstimateResponse = await response.json();
          update({ dayMeals: result.meals, unparsed: result.unparsed, dayNotes: result.notes, hasDayResult: true, result: null, requestId: null });
        } else {
          const result: EstimateResponse = await response.json();
          update({ result, hasDayResult: false, requestId: null });
        }
      } catch { setError("Could not connect. Your text is kept; reconnect and try again."); }
      finally { estimating.current = false; }
    });
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current || (isFullDay ? draft.dayMeals.length === 0 : !draft.result?.items.length)) return;
    saving.current = true;
    setError(null);
    const attempted = { ...draft, requestId: draft.requestId ?? crypto.randomUUID() };
    // Persist the attempt before sending it, so a lost response can be retried safely after reload.
    setDraft(attempted);
    if (userId) setStorageAvailable(writeScopedDraft(scope, attempted));
    startApply(async () => {
      try {
        const result = isFullDay
          ? await onApplyDay({ date, meals: attempted.dayMeals, sourceText: attempted.text, requestId: attempted.requestId, expectedUserId: userId })
          : await onApply({ date, mealType: attempted.mealType, mealName: attempted.mealName || undefined, estimate: attempted.result!, sourceText: attempted.text, requestId: attempted.requestId, expectedUserId: userId });
        if (result.undone) {
          update({ requestId: null });
          setError("That earlier save was undone. Review this meal, then save again if you want to add it.");
          return;
        }
        removeScopedDraft(scope);
        setDraft(emptyMealDraft(initialMealType));
        setRestored(false);
        setSuccess(result);
        setSuccessNote(attempted.unparsed.length ? `${attempted.unparsed.length} unrecognized item(s) were left unlogged. Add those with saved foods or manual entry.` : "");
      } catch { setError("Could not confirm the save. Your reviewed meal is kept. Retry save to check safely without adding duplicates."); }
      finally { saving.current = false; }
    });
  }

  function undo() {
    if (!success) return;
    setError(null);
    startUndo(async () => {
      try { await undoLogBatch({ batchId: success.batchId, expectedUserId: userId }); setSuccess(null); setSuccessNote("Meal addition undone."); }
      catch { setError("Could not undo. Try Undo again; your saved meal is still visible in history."); }
    });
  }

  const items = isFullDay ? draft.dayMeals.flatMap((meal) => meal.items) : draft.result?.items ?? [];
  const totalKcal = items.reduce((sum, item) => sum + item.nutrients.kcal, 0);
  const locked = Boolean(draft.requestId) || isPending || isApplying;
  if (!ready) return <div className="py-5 text-sm text-gray-500" role="status">Opening your meal draft…</div>;

  return <div className="space-y-3">
    {restored && <p className="text-xs text-gray-500" role="status">Draft restored on this device.</p>}
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {(success || successNote) && <div role="status" className="rounded-xl bg-brand-50 p-3 text-sm text-brand-800">
      {success && <div className="flex flex-wrap items-center justify-between gap-2"><span>{success.entryCount} item{success.entryCount === 1 ? "" : "s"} saved.</span><button type="button" onClick={undo} disabled={isUndoing} className="min-h-11 rounded-lg px-3 font-bold underline disabled:opacity-50">{isUndoing ? "Undoing…" : "Undo"}</button></div>}
      {successNote && <p>{successNote}</p>}
    </div>}

    <form onSubmit={save} className="space-y-3">
      <fieldset disabled={locked} className="space-y-3 disabled:opacity-70">
        {!isFullDay && <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm"><span>Meal</span><select value={draft.mealType} onChange={(e) => update({ mealType: e.target.value as MealDraft["mealType"] })} className={inputClass}>{MEALS.map((meal) => <option key={meal.key} value={meal.key}>{meal.label}</option>)}</select></label>
          {draft.mealType === "CUSTOM" && <label className="grid gap-1 text-sm"><span>Meal name</span><input value={draft.mealName} maxLength={200} onChange={(e) => update({ mealName: e.target.value })} className={inputClass} /></label>}
        </div>}
        {!draft.hasDayResult && !draft.result && <>
          <label className="grid gap-1 text-sm"><span>{isFullDay ? "Everything you ate today" : "What did you eat?"}</span><textarea value={draft.text} maxLength={isFullDay ? 3000 : 2000} onChange={(e) => update({ text: e.target.value })} placeholder={isFullDay ? "Breakfast: eggs and toast. Lunch: dal and rice. Dinner: chicken and salad." : "e.g. 2 scrambled eggs, 2 slices of toast with butter"} rows={isFullDay ? 4 : 3} className={inputClass} /></label>
          <p className="text-xs text-gray-500">You can use your keyboard’s microphone to dictate. Review the text before estimating.</p>
          <button type="button" onClick={estimate} disabled={draft.text.trim().length < (isFullDay ? 10 : 1)} className={actionClass}>{isPending ? "Estimating…" : "Estimate and review"}</button>
        </>}

        {draft.result && !isFullDay && <div className="space-y-3">
          <p className="text-sm font-semibold">Review quantities before saving</p>
          {draft.result.items.map((item, index) => <ReviewItem key={index} item={item}
            onQuantity={(quantity) => update({ result: { ...draft.result!, items: draft.result!.items.map((value, i) => i === index ? scaleEstimatedItem(value, quantity) : value) } })}
            onRemove={() => update({ result: { ...draft.result!, items: draft.result!.items.filter((_, i) => i !== index) } })} />)}
          {draft.result.notes.length > 0 && <p className="text-xs text-gray-500">{draft.result.notes.join(" · ")}</p>}
        </div>}

        {draft.hasDayResult && <div className="space-y-3">
          <p className="text-sm font-semibold">Review your day</p>
          {draft.dayMeals.map((meal, mealIndex) => <div key={mealIndex} className="space-y-2 rounded-xl border border-gray-200 p-3">
            <label className="grid gap-1 text-sm"><span>Meal</span><select value={meal.mealType} onChange={(e) => update({ dayMeals: draft.dayMeals.map((value, i) => i === mealIndex ? { ...value, mealType: e.target.value as DayMeal["mealType"] } : value) })} className={inputClass}>{MEALS.map((value) => <option key={value.key} value={value.key}>{value.label}</option>)}</select></label>
            {meal.items.map((item, itemIndex) => <ReviewItem key={itemIndex} item={item}
              onQuantity={(quantity) => update({ dayMeals: draft.dayMeals.map((value, mi) => mi === mealIndex ? { ...value, items: value.items.map((entry, ei) => ei === itemIndex ? scaleEstimatedItem(entry, quantity) : entry) } : value) })}
              onRemove={() => update({ dayMeals: draft.dayMeals.map((value, mi) => mi === mealIndex ? { ...value, items: value.items.filter((_, ei) => ei !== itemIndex) } : value).filter((value) => value.items.length > 0) })} />)}
          </div>)}
          {draft.unparsed.length > 0 && <div className="rounded-xl bg-orange-50 p-3 text-sm text-orange-800"><p className="font-semibold">These items will not be logged</p><ul className="my-2 list-disc pl-5">{draft.unparsed.map((value, index) => <li key={index}>{value}</li>)}</ul><p>Add them with saved foods or manual entry when you know their nutrition.</p></div>}
          {draft.dayNotes && <p className="text-xs text-gray-500">{draft.dayNotes}</p>}
        </div>}
      </fieldset>
      {(draft.result || draft.hasDayResult) && <>
        <p className="rounded-xl bg-brand-50 p-3 text-sm font-semibold text-brand-800">{items.length} items · approximately {Math.round(totalKcal)} kcal</p>
        {draft.requestId && <p className="text-xs text-gray-600">A save was attempted. Retry this unchanged meal to confirm it safely.</p>}
        {items.length > 100 && <p role="alert" className="text-sm text-red-700">Save up to 100 items at a time. Remove some items before saving.</p>}
        <button type="submit" disabled={isApplying || items.length === 0 || items.length > 100} className={`${actionClass} w-full`}>{isApplying ? "Saving…" : draft.requestId ? "Retry save safely" : isFullDay ? "Save reviewed day" : "Save reviewed meal"}</button>
      </>}
    </form>
    <DraftPrivacy available={storageAvailable} disabled={isPending || isApplying} onDiscard={discard} />
  </div>;
}
