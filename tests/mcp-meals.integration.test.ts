import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { prisma } from "../lib/db";
import {
  CorrectMealEntriesSchema, GetSavedMealsSchema, ShareMealSchema,
  correctMcpMealEntries, getMcpBuddyMeals, getMcpSavedMeals, logMcpExistingMeal,
  removeMcpMealPreset, respondMcpSharedMeal, saveMcpMealPreset, shareMcpMeal,
} from "../lib/mcp-meals";
import { commitMcpMeal, prepareMcpMeal } from "../lib/mcp-nutrition";

const database = new URL(process.env.DATABASE_URL || "file:///missing-fixture");
assert.equal(database.hostname, "localhost");
assert.equal(database.username, "nt_fixture");
assert.equal(database.pathname, "/nutritracker_test");
assert.match(database.searchParams.get("host") || "", /^\/.*\/nt-fixture-[a-f0-9]{12}\/socket$/);
const ids: string[] = [];
const date = "2026-11-04";
const oldSecret = process.env.AUTH_SECRET;

before(async () => {
  const [settings] = await prisma.$queryRaw<Array<{ database: string; listen: string }>>`SELECT current_database() AS database, current_setting('listen_addresses') AS listen`;
  assert.equal(settings.database, "nutritracker_test"); assert.equal(settings.listen, "");
  process.env.AUTH_SECRET = "fixture-mcp-meal-extensions-secret-0123456789";
});
after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.food.deleteMany({ where: { createdByUserId: { in: ids } } });
  await prisma.$disconnect();
  if (oldSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = oldSecret;
});
async function fixture() {
  const [a, b] = await Promise.all(["a", "b"].map(async role => {
    const user = await prisma.user.create({ data: { username: `mcp-meals-${role}-${randomUUID()}`, passwordHash: "fixture-no-login", profile: { create: { healthConditions: ["private medical detail"] } } } });
    ids.push(user.id); return user;
  }));
  const food = await prisma.food.create({ data: { name: "Fixture rice", createdByUserId: a.id, source: "MANUAL", kcalPer100g: 100, proteinPer100g: 2, carbsPer100g: 20, fatPer100g: 1 } });
  const entry = await prisma.logEntry.create({ data: { userId: a.id, foodId: food.id, date, mealType: "LUNCH", amount: 100,
    snapshotKcal: 100, snapshotProteinG: 2, snapshotCarbsG: 20, snapshotFatG: 1, snapshotFiberG: 0,
    sourceText: "private unrelated breakfast and medical note", estimationMeta: { originalUnit: "g", originalQuantity: 100, notes: "private unrelated full-day note" } } });
  return { a, b, food, entry, source: { kind: "entries" as const, entryIds: [entry.id] } };
}
const key = () => randomUUID();

test("presets are scoped, bounded, duplicate-safe and never resurrect after deletion", async () => {
  const { a, b, source } = await fixture();
  const input = { requestId: key(), name: "Usual lunch", source };
  const results = await Promise.all(Array.from({ length: 4 }, () => saveMcpMealPreset(a.id, input)));
  assert.equal(new Set(results.map(row => row.id)).size, 1);
  await assert.rejects(saveMcpMealPreset(a.id, { ...input, name: "Changed request" }), /request ID/);
  assert.equal((await getMcpSavedMeals(b.id)).meals.length, 0);
  await assert.rejects(saveMcpMealPreset(b.id, { ...input, requestId: key() }), /belong/);
  await saveMcpMealPreset(a.id, { ...input, requestId: key(), name: "Second" });
  const list = await getMcpSavedMeals(a.id, { limit: 1 });
  assert.equal(list.meals.length, 1); assert.equal(list.hasMore, true); assert.equal(list.nextOffset, 1);
  const saved = results[0];
  await assert.rejects(removeMcpMealPreset(b.id, { requestId: key(), id: saved.id, expectedUpdatedAt: saved.updatedAt }), /not found/);
  const deletion = { requestId: key(), id: saved.id, expectedUpdatedAt: saved.updatedAt };
  await removeMcpMealPreset(a.id, deletion);
  await removeMcpMealPreset(a.id, deletion);
  await saveMcpMealPreset(a.id, input);
  assert.equal(await prisma.savedMeal.count({ where: { id: saved.id } }), 0);
});

test("logging saved and existing meals preserves snapshots and retries do not duplicate", async () => {
  const { a, b, entry, source } = await fixture();
  const saved = await saveMcpMealPreset(a.id, { requestId: key(), name: "Lunch", source });
  const input = { requestId: key(), source: { kind: "saved" as const, id: saved.id }, date, mealType: "DINNER" as const, multiplier: 2 };
  await assert.rejects(logMcpExistingMeal(b.id, input), /not found/);
  const result = await logMcpExistingMeal(a.id, input);
  await logMcpExistingMeal(a.id, input);
  await assert.rejects(logMcpExistingMeal(a.id, { ...input, multiplier: 3 }), /request ID/);
  const rows = await prisma.logEntry.findMany({ where: { batchId: result.batchId } });
  assert.equal(rows.length, 1); assert.equal(rows[0].amount, 200); assert.equal(rows[0].snapshotKcal, 200); assert.equal(rows[0].snapshotFiberG, 0);
  assert.equal(rows[0].mealType, "DINNER"); assert.equal((await prisma.logEntry.findUniqueOrThrow({ where: { id: entry.id } })).amount, 100);
});

test("meal corrections scale current snapshots, reject stale and foreign edits, and replay safely", async () => {
  const { a, b, entry } = await fixture();
  const input = { requestId: key(), entries: [{ action: "update" as const, entryId: entry.id, expectedUpdatedAt: entry.updatedAt.toISOString(), multiplier: 0.5, mealType: "DINNER" as const }] };
  await assert.rejects(correctMcpMealEntries(b.id, input), /belong/);
  await correctMcpMealEntries(a.id, input); await correctMcpMealEntries(a.id, input);
  const changed = await prisma.logEntry.findUniqueOrThrow({ where: { id: entry.id } });
  assert.equal(changed.amount, 50); assert.equal(changed.snapshotKcal, 50); assert.equal(changed.snapshotFiberG, 0); assert.equal(changed.mealType, "DINNER");
  assert.ok(changed.updatedAt > entry.updatedAt);
  await assert.rejects(correctMcpMealEntries(a.id, { ...input, requestId: key() }), /changed/);
  await assert.rejects(correctMcpMealEntries(a.id, { ...input, entries: [{ ...input.entries[0], multiplier: 0.25 }] }), /request ID/);
});

test("multi-entry corrections roll back when another entry has changed", async () => {
  const { a, entry, food } = await fixture();
  const second = await prisma.logEntry.create({ data: { userId: a.id, foodId: food.id, date, mealType: "LUNCH", amount: 50 } });
  const input = { requestId: key(), entries: [
    { action: "remove" as const, entryId: entry.id, expectedUpdatedAt: entry.updatedAt.toISOString() },
    { action: "remove" as const, entryId: second.id, expectedUpdatedAt: "2000-01-01T00:00:00.000Z" },
  ] };
  await assert.rejects(correctMcpMealEntries(a.id, input), /changed/);
  assert.equal(await prisma.logEntry.count({ where: { id: { in: [entry.id, second.id] } } }), 2);
  assert.equal(await prisma.mcpMutation.count({ where: { userId: a.id, requestId: input.requestId } }), 0);
});

test("a deleted MCP meal stays removed even when its original prepared token is retried", async () => {
  const { a } = await fixture();
  const prepared = await prepareMcpMeal(a.id, { description: "Fixture apple", date, mealType: "SNACK" }, { estimate: async () => ({ items: [{ description: "Apple", quantity: 100, unit: "g", nutrients: { kcal: 50, protein_g: 0, carbs_g: 12, fat_g: 0, fiber_g: 1 }, confidence: 1, assumptions: ["Fixture only"] }], notes: [] }) });
  const saved = await commitMcpMeal(a.id, { preparedMealToken: prepared.preparedMealToken });
  const entries = await prisma.logEntry.findMany({ where: { batchId: saved.batchId } });
  await correctMcpMealEntries(a.id, { requestId: key(), entries: entries.map(entry => ({ action: "remove", entryId: entry.id, expectedUpdatedAt: entry.updatedAt.toISOString() })) });
  const retried = await commitMcpMeal(a.id, { preparedMealToken: prepared.preparedMealToken });
  assert.equal(retried.undone, true); assert.equal(retried.saved, false);
  assert.equal(await prisma.logEntry.count({ where: { batchId: saved.batchId } }), 0);
});

test("sharing requires an accepted buddy and explicit confirmation, strips unrelated text, and waits for recipient acceptance", async () => {
  const { a, b, source } = await fixture();
  const input = { requestId: key(), source, date, mealType: "LUNCH" as const, recipientId: b.id, confirmed: true as const };
  await assert.rejects(shareMcpMeal(a.id, input), /connected buddy/);
  const relationship = await prisma.buddyRelationship.create({ data: { requesterId: b.id, addresseeId: a.id, status: "ACCEPTED" } });
  const sent = await shareMcpMeal(a.id, input); await shareMcpMeal(a.id, input);
  assert.equal(await prisma.mealProposal.count({ where: { senderId: a.id } }), 1);
  assert.equal(await prisma.logEntry.count({ where: { userId: b.id } }), 0);
  const incoming = await getMcpBuddyMeals(b.id);
  assert.equal(incoming.buddies[0].username, a.username); assert.equal(incoming.incoming.length, 1);
  assert.doesNotMatch(JSON.stringify(incoming), /private unrelated|private medical|passwordHash/);
  const stored = await prisma.mealProposal.findUniqueOrThrow({ where: { id: sent.proposalId } });
  assert.doesNotMatch(JSON.stringify(stored.items), /private unrelated|private medical/);
  await assert.rejects(respondMcpSharedMeal(a.id, { requestId: key(), proposalId: sent.proposalId, action: "decline" }), /not available/);
  const accept = { requestId: key(), proposalId: sent.proposalId, action: "accept" as const, date: "2026-11-05", mealType: "BREAKFAST" as const, multiplier: 0.5 };
  const accepted = await respondMcpSharedMeal(b.id, accept); await respondMcpSharedMeal(b.id, accept);
  assert.equal(accepted.saved, true);
  const rows = await prisma.logEntry.findMany({ where: { userId: b.id } });
  assert.equal(rows.length, 1); assert.equal(rows[0].snapshotKcal, 50); assert.equal(rows[0].date, "2026-11-05"); assert.equal(rows[0].mealType, "BREAKFAST");
  await assert.rejects(respondMcpSharedMeal(b.id, { ...accept, requestId: key(), multiplier: 1 }), /already been answered/);
  const another = await shareMcpMeal(a.id, { ...input, requestId: key() });
  await prisma.buddyRelationship.delete({ where: { id: relationship.id } });
  assert.equal((await getMcpBuddyMeals(b.id)).incoming.length, 0);
  await assert.rejects(respondMcpSharedMeal(b.id, { requestId: key(), proposalId: another.proposalId, action: "decline" }), /connected buddy/);
});

test("accept and decline race to one result; declined proposals never log meals", async () => {
  const { a, b, source } = await fixture();
  await prisma.buddyRelationship.create({ data: { requesterId: a.id, addresseeId: b.id, status: "ACCEPTED" } });
  const sent = await shareMcpMeal(a.id, { requestId: key(), source, date, mealType: "LUNCH", recipientId: b.id, confirmed: true });
  const outcomes = await Promise.allSettled([
    respondMcpSharedMeal(b.id, { requestId: key(), proposalId: sent.proposalId, action: "accept", date, mealType: "DINNER" }),
    respondMcpSharedMeal(b.id, { requestId: key(), proposalId: sent.proposalId, action: "decline" }),
  ]);
  assert.equal(outcomes.filter(outcome => outcome.status === "fulfilled").length, 1);
  const row = await prisma.mealProposal.findUniqueOrThrow({ where: { id: sent.proposalId } });
  assert.equal(await prisma.logEntry.count({ where: { userId: b.id } }), row.status === "ACCEPTED" ? 1 : 0);
  const declined = await shareMcpMeal(a.id, { requestId: key(), source, date, mealType: "LUNCH", recipientId: b.id, confirmed: true });
  const before = await prisma.logEntry.count({ where: { userId: b.id } });
  await respondMcpSharedMeal(b.id, { requestId: key(), proposalId: declined.proposalId, action: "decline" });
  assert.equal(await prisma.logEntry.count({ where: { userId: b.id } }), before);
});

test("meal tool schemas reject implicit sharing, injected identity and duplicate corrections", () => {
  assert.equal(ShareMealSchema.safeParse({ requestId: key(), source: { kind: "saved", id: "x" }, date, mealType: "LUNCH", recipientId: "y" }).success, false);
  assert.equal(GetSavedMealsSchema.safeParse({ userId: "other" }).success, false);
  assert.equal(GetSavedMealsSchema.safeParse({ limit: 51 }).success, false);
  const entry = { action: "remove", entryId: "x", expectedUpdatedAt: "2026-11-04T00:00:00.000Z" };
  assert.equal(CorrectMealEntriesSchema.safeParse({ requestId: key(), entries: [entry, entry] }).success, false);
});
