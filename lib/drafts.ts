import { z } from "zod";

export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;
export const DRAFT_STORAGE_PREFIX = "nutritracker:meal-draft:v1:";
export const DRAFTS_CLEARED_EVENT = "nutritracker:meal-drafts-cleared";

export type DraftScope = { userId: string; date: string; mode: "single" | "fullday" | "manual" };
export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

const nutrient = z.number().finite().nonnegative().max(10_000_000);
const item = z.object({
  description: z.string().max(2000),
  quantity: z.number().finite().positive().max(1_000_000),
  unit: z.literal("g"),
  nutrients: z.object({ kcal: nutrient, protein_g: nutrient, carbs_g: nutrient, fat_g: nutrient, fiber_g: nutrient.optional(), sodium_mg: nutrient.optional() }),
  confidence: z.number().finite().min(0).max(1),
  assumptions: z.array(z.string().max(4000)).max(100),
});
export const MealDraftSchema = z.object({
  text: z.string().max(6000),
  mealType: z.enum(["BREAKFAST", "LUNCH", "DINNER", "SNACK", "CUSTOM"]),
  mealName: z.string().max(200),
  result: z.object({ items: z.array(item).max(100), notes: z.array(z.string().max(4000)).max(100) }).nullable(),
  dayMeals: z.array(z.object({
    mealType: z.enum(["BREAKFAST", "LUNCH", "DINNER", "SNACK", "CUSTOM"]),
    mealName: z.string().max(200).nullish(),
    detectedFrom: z.string().max(4000),
    items: z.array(item).max(100),
  })).max(20),
  unparsed: z.array(z.string().max(4000)).max(100),
  dayNotes: z.string().max(12000),
  hasDayResult: z.boolean(),
  requestId: z.string().min(1).max(128).nullable(),
});
export type MealDraft = z.infer<typeof MealDraftSchema>;

export function emptyMealDraft(mealType: MealDraft["mealType"] = "DINNER"): MealDraft {
  return { text: "", mealType, mealName: "", result: null, dayMeals: [], unparsed: [], dayNotes: "", hasDayResult: false, requestId: null };
}

export function mealDraftKey(scope: DraftScope): string {
  return `${DRAFT_STORAGE_PREFIX}${encodeURIComponent(scope.userId)}:${scope.date}:${scope.mode}`;
}

function browserStorage(): DraftStorage | null {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
}

export function removeScopedDraft(scope: DraftScope, storage: DraftStorage | null = browserStorage()): void {
  try { storage?.removeItem(mealDraftKey(scope)); } catch { /* Storage may be unavailable. */ }
}

/** Reject unknown versions, expired or malformed data, and any mismatched account scope. */
export function readScopedDraft<T>(
  scope: DraftScope,
  parse: (value: unknown) => T | null,
  storage: DraftStorage | null = browserStorage(),
  now = Date.now(),
): T | null {
  if (!storage || !scope.userId) return null;
  try {
    const raw = storage.getItem(mealDraftKey(scope));
    if (!raw) return null;
    if (raw.length > 256_000) throw new Error("Oversized draft");
    const saved = JSON.parse(raw);
    if (saved.version !== 1 || saved.scope?.userId !== scope.userId || saved.scope?.date !== scope.date || saved.scope?.mode !== scope.mode ||
        !Number.isFinite(saved.savedAt) || saved.savedAt > now || now - saved.savedAt >= DRAFT_TTL_MS) throw new Error("Invalid draft");
    const draft = parse(saved.payload);
    if (draft === null) throw new Error("Invalid draft contents");
    return draft;
  } catch {
    removeScopedDraft(scope, storage);
    return null;
  }
}

export function writeScopedDraft(
  scope: DraftScope,
  payload: unknown,
  storage: DraftStorage | null = browserStorage(),
  now = Date.now(),
): boolean {
  if (!storage || !scope.userId) return false;
  try {
    const value = JSON.stringify({ version: 1, scope, savedAt: now, payload });
    if (value.length > 256_000) return false;
    storage.setItem(mealDraftKey(scope), value);
    return true;
  } catch { return false; }
}

/** Called on logout. Unrelated website storage is left untouched. */
export function clearMealDrafts(storage: DraftStorage | null = browserStorage()): void {
  if (!storage) return;
  try {
    const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i));
    for (const key of keys) if (key?.startsWith(DRAFT_STORAGE_PREFIX)) storage.removeItem(key);
  } catch { /* A privacy-mode storage error must not block logout. */ }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(DRAFTS_CLEARED_EVENT));
}

/** Expiry cleanup also removes drafts belonging to a previously signed-in account. */
export function pruneMealDrafts(userId: string, storage: DraftStorage | null = browserStorage(), now = Date.now()): void {
  if (!storage) return;
  try {
    const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i));
    for (const key of keys) {
      if (!key?.startsWith(DRAFT_STORAGE_PREFIX)) continue;
      try {
        const value = JSON.parse(storage.getItem(key) ?? "null");
        if (value?.version !== 1 || value?.scope?.userId !== userId || !Number.isFinite(value.savedAt) || value.savedAt > now || now - value.savedAt >= DRAFT_TTL_MS) storage.removeItem(key);
      } catch { storage.removeItem(key); }
    }
  } catch { /* Best effort when browser storage is disabled. */ }
}

/** Adjust a reviewed portion without another AI request; all nutrient totals scale together. */
export function scaleEstimatedItem<T extends { quantity: number; nutrients: Record<string, number | undefined> }>(value: T, quantity: number): T {
  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(value.quantity) || value.quantity <= 0) return value;
  const factor = quantity / value.quantity;
  return { ...value, quantity, nutrients: Object.fromEntries(Object.entries(value.nutrients).map(([key, number]) => [key, number == null ? number : number * factor])) };
}
