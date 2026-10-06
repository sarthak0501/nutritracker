"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { z } from "zod";
import { EstimateFromText, type EstimateFromTextProps } from "@/components/EstimateFromText";
import { DraftPrivacy } from "@/components/DraftPrivacy";
import { searchFoods, type FoodSearchResult } from "@/app/actions/food-search";
import { createLogEntryFromExistingFood, undoLogBatch } from "@/app/actions/logging";
import type { LogResult } from "@/lib/meal-writes";
import { DRAFTS_CLEARED_EVENT, pruneMealDrafts, readScopedDraft, removeScopedDraft, writeScopedDraft, type DraftScope } from "@/lib/drafts";

const MEALS = ["BREAKFAST", "LUNCH", "DINNER", "SNACK", "CUSTOM"] as const;
const mealLabel = (value: string) => value === "SNACK" ? "Snacks" : value.charAt(0) + value.slice(1).toLowerCase();
const inputClass = "w-full rounded-xl border-0 bg-surface-muted px-3 py-2.5 text-base focus:ring-2 focus:ring-brand-500";
const buttonClass = "min-h-11 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50";
const finiteNutrient = z.number().finite().nonnegative();
const ChoiceSchema = z.object({
  id: z.string(), name: z.string(), lastEntryId: z.string(), lastMealType: z.string(), portionLabel: z.string(),
  lastAmount: z.number().finite().positive(), lastUnit: z.enum(["GRAM", "SERVING"]),
  lastNutrients: z.object({ kcal: finiteNutrient, protein_g: finiteNutrient, carbs_g: finiteNutrient, fat_g: finiteNutrient, fiber_g: finiteNutrient.optional() }).nullable(),
});
const fieldsSchema = z.object({
  name: z.string().max(200), brand: z.string().max(200), amount: z.string().max(30), mealType: z.enum(MEALS),
  kcalPer100g: z.string().max(30), proteinPer100g: z.string().max(30), carbsPer100g: z.string().max(30), fatPer100g: z.string().max(30), fiberPer100g: z.string().max(30),
});
const ManualDraftSchema = z.object({
  step: z.enum(["search", "log-existing", "create-new"]), query: z.string().max(200), selected: ChoiceSchema.nullable(),
  multiplier: z.string().max(30), mealType: z.enum(MEALS), fields: fieldsSchema, requestId: z.string().min(1).max(128).nullable(),
});
type ManualDraft = z.infer<typeof ManualDraftSchema>;
function emptyManualDraft(): ManualDraft {
  return { step: "search", query: "", selected: null, multiplier: "1", mealType: "BREAKFAST", requestId: null,
    fields: { name: "", brand: "", amount: "100", mealType: "BREAKFAST", kcalPer100g: "", proteinPer100g: "", carbsPer100g: "", fatPer100g: "", fiberPer100g: "" } };
}

type Props = {
  date: string; userId: string;
  onApplyEstimate: EstimateFromTextProps["onApply"];
  onApplyDay: EstimateFromTextProps["onApplyDay"];
  manualAction: (formData: FormData) => Promise<LogResult>;
};

export function LogMealTabs(props: Props) {
  return <MealTabs key={`${props.userId ?? "no-drafts"}:${props.date}`} {...props} />;
}

function MealTabs({ date, userId, onApplyEstimate, onApplyDay, manualAction }: Props) {
  const [mode, setMode] = useState<"manual" | "quick" | "fullday">("manual");
  const [draft, setDraft] = useState<ManualDraft>(emptyManualDraft);
  const [ready, setReady] = useState(false);
  const [storageAvailable, setStorageAvailable] = useState(Boolean(userId));
  const [results, setResults] = useState<FoodSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<LogResult | null>(null);
  const [notice, setNotice] = useState("");
  const [logging, startLog] = useTransition();
  const [undoing, startUndo] = useTransition();
  const lastStored = useRef("");
  const inFlight = useRef(false);
  const scope: DraftScope = { userId: userId ?? "", date, mode: "manual" };

  useEffect(() => {
    if (userId) pruneMealDrafts(userId);
    const saved = userId ? readScopedDraft(scope, (value) => { const parsed = ManualDraftSchema.safeParse(value); return parsed.success ? parsed.data : null; }) : null;
    const next = saved ?? emptyManualDraft();
    setDraft(next);
    lastStored.current = JSON.stringify(next);
    try { setStorageAvailable(Boolean(userId && window.localStorage)); } catch { setStorageAvailable(false); }
    setReady(true);
    const clear = () => { setReady(false); setDraft(emptyManualDraft()); };
    window.addEventListener(DRAFTS_CLEARED_EVENT, clear);
    return () => window.removeEventListener(DRAFTS_CLEARED_EVENT, clear);
    // Keyed by account and date.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ready || !userId) return;
    const serialized = JSON.stringify(draft);
    if (lastStored.current === serialized) return;
    lastStored.current = serialized;
    if (draft.query || draft.selected || draft.fields.name || draft.step === "create-new") setStorageAvailable(writeScopedDraft(scope, draft));
    else removeScopedDraft(scope);
    // Scope is fixed for this keyed instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, ready, userId]);

  useEffect(() => {
    if (mode !== "manual" || draft.step !== "search" || !ready) return;
    let cancelled = false;
    setResults([]);
    if (!draft.query.trim()) { setSearching(false); return; }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const found = await searchFoods(draft.query);
        if (!cancelled) { setResults(found); setError(null); }
      } catch { if (!cancelled) setError("Could not search your foods. Try again when connected, or create a manual entry."); }
      finally { if (!cancelled) setSearching(false); }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [draft.query, draft.step, mode, ready]);

  function update(patch: Partial<ManualDraft>) { setDraft((previous) => ({ ...previous, ...patch })); setError(null); }
  function updateField(field: keyof ManualDraft["fields"], value: string) { setDraft((previous) => ({ ...previous, fields: { ...previous.fields, [field]: value } })); setError(null); }
  function selectFood(food: FoodSearchResult) {
    const selected = ChoiceSchema.safeParse(food);
    if (!selected.success) { setError("This older food cannot be reused safely yet. Enter its nutrition manually."); return; }
    update({ selected: selected.data, multiplier: "1", mealType: MEALS.find((value) => value === food.lastMealType) ?? "BREAKFAST", step: "log-existing", requestId: null });
  }
  function discard() {
    if (draft.requestId && !window.confirm("A save may already have reached your account. Discard this draft? Check your history before adding it again.")) return;
    removeScopedDraft(scope); setDraft(emptyManualDraft()); setResults([]); setError(null);
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const existing = draft.step === "log-existing";
    if (existing && (!draft.selected || !draft.selected.lastNutrients)) return;
    if (!existing && !draft.fields.name.trim()) { setError("Enter a food name before saving."); return; }
    const attempted = { ...draft, requestId: draft.requestId ?? crypto.randomUUID() };
    const form = new FormData();
    form.set("date", date); form.set("requestId", attempted.requestId); form.set("expectedUserId", userId);
    if (existing) {
      form.set("sourceEntryId", attempted.selected!.lastEntryId);
      form.set("foodId", attempted.selected!.id);
      form.set("amount", String(attempted.selected!.lastAmount));
      form.set("unit", attempted.selected!.lastUnit);
      form.set("portionMultiplier", attempted.multiplier);
      form.set("mealType", attempted.mealType);
    } else {
      for (const [key, value] of Object.entries(attempted.fields)) form.set(key, value);
      form.set("unit", "GRAM");
    }
    setDraft(attempted);
    if (userId) setStorageAvailable(writeScopedDraft(scope, attempted));
    setError(null); inFlight.current = true;
    startLog(async () => {
      try {
        const saved = existing ? await createLogEntryFromExistingFood(form) : await manualAction(form);
        if (saved.undone) { update({ requestId: null }); setError("This earlier addition was undone. Review and save again to add it."); return; }
        removeScopedDraft(scope); setDraft(emptyManualDraft()); setResults([]); setSuccess(saved); setNotice("");
      } catch { setError("Could not confirm the save. Your draft is kept. Retry this unchanged entry safely."); }
      finally { inFlight.current = false; }
    });
  }
  function undo() {
    if (!success) return;
    setError(null);
    startUndo(async () => {
      try { await undoLogBatch({ batchId: success.batchId, expectedUserId: userId }); setSuccess(null); setNotice("Meal addition undone."); }
      catch { setError("Could not undo. Try again; you can also check the saved entry in history."); }
    });
  }

  const locked = logging || Boolean(draft.requestId);
  const multiplier = Number(draft.multiplier);
  const selectedNutrients = draft.selected?.lastNutrients;
  return <div>
    <div className="mb-4 grid grid-cols-3 gap-2" aria-label="How to log food">
      {([{ key: "manual", label: "Saved / manual" }, { key: "quick", label: "Describe meal" }, { key: "fullday", label: "Whole day" }] as const).map((tab) => <button key={tab.key} type="button" onClick={() => setMode(tab.key)} aria-pressed={mode === tab.key} className={`min-h-11 rounded-xl px-2 py-2 text-sm font-semibold ${mode === tab.key ? "bg-brand-600 text-white" : "bg-surface-muted text-gray-600"}`}>{tab.label}</button>)}
    </div>
    {/* Keep each draft mounted while switching modes, including an in-flight estimate. */}
    <div hidden={mode !== "quick"}><EstimateFromText date={date} userId={userId} onApply={onApplyEstimate} onApplyDay={onApplyDay} forceMode="single" /></div>
    <div hidden={mode !== "fullday"}><EstimateFromText date={date} userId={userId} onApply={onApplyEstimate} onApplyDay={onApplyDay} forceMode="fullday" /></div>
    <div hidden={mode !== "manual"}>{!ready ? <p role="status" className="text-sm text-gray-500">Opening your food draft…</p> : <div className="space-y-3">
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {(success || notice) && <div role="status" className="rounded-xl bg-brand-50 p-3 text-sm text-brand-800">{success && <div className="flex items-center justify-between gap-2"><span>{success.entryCount} item{success.entryCount === 1 ? "" : "s"} saved.</span><button type="button" onClick={undo} disabled={undoing} className="min-h-11 px-3 font-bold underline">{undoing ? "Undoing…" : "Undo"}</button></div>}{notice}</div>}
      {draft.step === "search" && <div className="space-y-3">
        <label className="grid gap-1 text-sm"><span>Find a food you have logged</span><input value={draft.query} maxLength={200} onChange={(e) => update({ query: e.target.value })} placeholder="Search your foods…" className={inputClass} /></label>
        {searching && <p role="status" className="text-sm text-gray-500">Searching…</p>}
        {!searching && draft.query && results.length === 0 && !error && <p className="text-sm text-gray-500">No matches yet. You can create a food from its label below.</p>}
        {results.length > 0 && <div className="divide-y divide-gray-100 overflow-hidden rounded-xl border border-gray-200">{results.map((food) => <button type="button" key={food.id} onClick={() => selectFood(food)} className="block min-h-14 w-full px-4 py-3 text-left hover:bg-gray-50"><span className="block text-sm font-semibold">{food.name}</span><span className="mt-1 block text-xs text-gray-500">{food.portionLabel}{food.lastNutrients ? ` · ${Math.round(food.lastNutrients.kcal)} kcal` : " · Nutrition unavailable"}</span></button>)}</div>}
        <button type="button" onClick={() => update({ step: "create-new" })} className="min-h-11 rounded-xl px-3 text-sm font-semibold text-brand-700">+ Create food from a nutrition label</button>
      </div>}
      {draft.step !== "search" && <form onSubmit={save} className="space-y-3">
        <fieldset disabled={locked} className="space-y-3 disabled:opacity-70">
          {draft.step === "log-existing" && draft.selected && <>
            <div className="rounded-xl bg-surface-muted p-3"><p className="font-semibold">{draft.selected.name}</p><p className="mt-1 text-sm text-gray-500">Previous portion: {draft.selected.portionLabel}</p></div>
            <label className="grid gap-1 text-sm"><span>Portions of your previous entry</span><input type="number" required inputMode="decimal" min="0.01" max="20" step="any" value={draft.multiplier} onChange={(e) => update({ multiplier: e.target.value })} className={inputClass} /></label>
            <div className="flex flex-wrap gap-2">{[0.5, 1, 1.5, 2].map((value) => <button key={value} type="button" onClick={() => update({ multiplier: String(value) })} className="min-h-11 rounded-lg border border-gray-200 px-4 text-sm">{value}×</button>)}</div>
            {selectedNutrients && Number.isFinite(multiplier) && multiplier > 0 && <p className="text-sm tabular-nums">{Math.round(selectedNutrients.kcal * multiplier)} kcal · {(selectedNutrients.protein_g * multiplier).toFixed(1)}P · {(selectedNutrients.carbs_g * multiplier).toFixed(1)}C · {(selectedNutrients.fat_g * multiplier).toFixed(1)}F</p>}
            {!selectedNutrients && <p role="alert" className="text-sm text-amber-700">This older entry has no reusable nutrition. Create it manually from known nutrition instead.</p>}
            <label className="grid gap-1 text-sm"><span>Meal</span><select value={draft.mealType} onChange={(e) => update({ mealType: e.target.value as ManualDraft["mealType"] })} className={inputClass}>{MEALS.map((meal) => <option key={meal} value={meal}>{mealLabel(meal)}</option>)}</select></label>
          </>}
          {draft.step === "create-new" && <>
            <label className="grid gap-1 text-sm"><span>Food name</span><input required maxLength={200} value={draft.fields.name} onChange={(e) => updateField("name", e.target.value)} className={inputClass} /></label>
            <label className="grid gap-1 text-sm"><span>Brand (optional)</span><input maxLength={200} value={draft.fields.brand} onChange={(e) => updateField("brand", e.target.value)} className={inputClass} /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1 text-sm"><span>Amount eaten (g)</span><input type="number" inputMode="decimal" required min="0.01" step="any" value={draft.fields.amount} onChange={(e) => updateField("amount", e.target.value)} className={inputClass} /></label>
              <label className="grid gap-1 text-sm"><span>Meal</span><select value={draft.fields.mealType} onChange={(e) => updateField("mealType", e.target.value)} className={inputClass}>{MEALS.map((meal) => <option key={meal} value={meal}>{mealLabel(meal)}</option>)}</select></label>
            </div>
            <p className="text-sm text-gray-500">Enter nutrition per 100 g from the label. Zero is a valid value.</p>
            <div className="grid grid-cols-2 gap-3">{([{ key: "kcalPer100g", label: "Calories" }, { key: "proteinPer100g", label: "Protein (g)" }, { key: "carbsPer100g", label: "Carbs (g)" }, { key: "fatPer100g", label: "Fat (g)" }, { key: "fiberPer100g", label: "Fiber (g, optional)" }] as const).map((field) => <label key={field.key} className="grid gap-1 text-sm"><span>{field.label}</span><input type="number" inputMode="decimal" required={field.key !== "fiberPer100g"} min="0" step="any" value={draft.fields[field.key]} onChange={(e) => updateField(field.key, e.target.value)} className={inputClass} /></label>)}</div>
          </>}
          <button type="button" onClick={() => update({ step: "search", selected: null })} className="min-h-11 px-3 text-sm text-gray-600">Back to search</button>
        </fieldset>
        {draft.requestId && <p className="text-xs text-gray-600">A save was attempted. Retry this unchanged entry to confirm it safely.</p>}
        <button type="submit" disabled={logging || (draft.step === "log-existing" && !selectedNutrients)} className={`${buttonClass} w-full`}>{logging ? "Saving…" : draft.requestId ? "Retry save safely" : "Save entry"}</button>
      </form>}
      <DraftPrivacy available={storageAvailable} onDiscard={discard} disabled={logging} />
    </div>}</div>
  </div>;
}
