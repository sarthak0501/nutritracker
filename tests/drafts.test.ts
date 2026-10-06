import test from "node:test";
import assert from "node:assert/strict";
import { DRAFT_STORAGE_PREFIX, DRAFT_TTL_MS, MealDraftSchema, clearMealDrafts, emptyMealDraft, mealDraftKey, pruneMealDrafts, readScopedDraft, removeScopedDraft, scaleEstimatedItem, writeScopedDraft, type DraftScope, type DraftStorage } from "../lib/drafts";

class MemoryStorage implements DraftStorage {
  data = new Map<string, string>();
  get length() { return this.data.size; }
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
  key(index: number) { return Array.from(this.data.keys())[index] ?? null; }
}
const scope: DraftScope = { userId: "fixture-account-a", date: "2026-10-06", mode: "single" };
const now = 123_456_789;
const parse = (value: unknown) => { const result = MealDraftSchema.safeParse(value); return result.success ? result.data : null; };
const meal = {
  ...emptyMealDraft(), text: "fixture meal", requestId: "stable-save-attempt",
  result: { items: [{ description: "fixture oats", quantity: 80, unit: "g" as const, confidence: 0.8, assumptions: [], nutrients: { kcal: 300, protein_g: 10, carbs_g: 50, fat_g: 5, fiber_g: 7, sodium_mg: 2 } }], notes: [] },
};

test("drafts preserve reviewed values and pending save ID, isolated by account/day/mode", () => {
  const storage = new MemoryStorage();
  assert.equal(writeScopedDraft(scope, meal, storage, now), true);
  assert.deepEqual(readScopedDraft(scope, parse, storage, now + 1), meal);
  assert.equal(readScopedDraft({ ...scope, userId: "fixture-account-b" }, parse, storage, now + 1), null);
  assert.equal(readScopedDraft({ ...scope, date: "2026-10-07" }, parse, storage, now + 1), null);
  assert.equal(readScopedDraft({ ...scope, mode: "fullday" }, parse, storage, now + 1), null);
  assert.deepEqual(readScopedDraft(scope, parse, storage, now + 2), meal);
});

test("reading does not extend the 24-hour expiry; exact cutoff removes the draft", () => {
  const storage = new MemoryStorage();
  writeScopedDraft(scope, meal, storage, now);
  const original = storage.getItem(mealDraftKey(scope));
  assert.ok(readScopedDraft(scope, parse, storage, now + DRAFT_TTL_MS - 1));
  assert.equal(storage.getItem(mealDraftKey(scope)), original);
  assert.equal(readScopedDraft(scope, parse, storage, now + DRAFT_TTL_MS), null);
  assert.equal(storage.getItem(mealDraftKey(scope)), null);
});

test("malformed, future-dated, wrong-scope, unknown-version and invalid-content drafts are rejected", () => {
  const storage = new MemoryStorage();
  const envelope = { version: 1, scope, savedAt: now, payload: meal };
  for (const value of ["not JSON", "null", JSON.stringify({ ...envelope, version: 2 }), JSON.stringify({ ...envelope, savedAt: now + 1 }), JSON.stringify({ ...envelope, scope: { ...scope, userId: "other" } }), JSON.stringify({ ...envelope, payload: { ...meal, result: { items: [{ quantity: -1 }], notes: [] } } })]) {
    storage.setItem(mealDraftKey(scope), value);
    assert.equal(readScopedDraft(scope, parse, storage, now), null);
    assert.equal(storage.getItem(mealDraftKey(scope)), null);
  }
});

test("logout clears only meal drafts; discard removes only its scope", () => {
  const storage = new MemoryStorage();
  storage.setItem("other-setting", "keep");
  writeScopedDraft(scope, meal, storage, now);
  writeScopedDraft({ ...scope, mode: "fullday" }, meal, storage, now);
  removeScopedDraft(scope, storage);
  assert.equal(storage.length, 2);
  clearMealDrafts(storage);
  assert.deepEqual([...storage.data], [["other-setting", "keep"]]);
});

test("account and expiry cleanup never removes unrelated settings or current drafts", () => {
  const storage = new MemoryStorage();
  writeScopedDraft(scope, meal, storage, now);
  writeScopedDraft({ ...scope, userId: "previous-account" }, meal, storage, now);
  writeScopedDraft({ ...scope, mode: "fullday" }, meal, storage, now - DRAFT_TTL_MS);
  storage.setItem(`${DRAFT_STORAGE_PREFIX}broken`, "broken");
  storage.setItem("other-setting", "keep");
  pruneMealDrafts(scope.userId, storage, now);
  assert.equal(storage.length, 2);
  assert.deepEqual(readScopedDraft(scope, parse, storage, now), meal);
});

test("disabled/full storage never throws or blocks saving/logout", () => {
  const storage: DraftStorage = { length: 1, key() { throw new Error("denied"); }, getItem() { throw new Error("denied"); }, setItem() { throw new Error("full"); }, removeItem() { throw new Error("denied"); } };
  assert.equal(writeScopedDraft(scope, meal, storage, now), false);
  assert.equal(readScopedDraft(scope, parse, storage, now), null);
  assert.doesNotThrow(() => clearMealDrafts(storage));
  assert.doesNotThrow(() => pruneMealDrafts(scope.userId, storage, now));
  assert.equal(writeScopedDraft(scope, meal, null, now), false);
});

test("portion review scales every nutrient without changing unit, provenance, or source value", () => {
  const source = meal.result.items[0];
  const scaled = scaleEstimatedItem(source, 40);
  assert.equal(scaled.quantity, 40);
  assert.equal(scaled.unit, "g");
  assert.equal(scaled.confidence, 0.8);
  assert.deepEqual(scaled.nutrients, { kcal: 150, protein_g: 5, carbs_g: 25, fat_g: 2.5, fiber_g: 3.5, sodium_mg: 1 });
  assert.equal(source.quantity, 80);
  assert.equal(source.nutrients.kcal, 300);
  for (const invalid of [0, -1, NaN, Infinity]) assert.equal(scaleEstimatedItem(source, invalid), source);
});
