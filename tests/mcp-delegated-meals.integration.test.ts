import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { prisma } from "../lib/db";
import { previewMcpBuddyMeal, logMcpBuddyMeal, type PreviewBuddyMealSchema } from "../lib/mcp-delegated-meals";
import { getMcpBuddyMeals, saveMcpMealPreset, shareMcpMeal, respondMcpSharedMeal } from "../lib/mcp-meals";
import { commitMcpMeal, undoMcpMeal } from "../lib/mcp-nutrition";
import { prepareRecipe } from "../lib/mcp-recipe";
import { type z } from "zod";

const database = new URL(process.env.DATABASE_URL || "file:///missing-fixture");
assert.equal(database.hostname, "localhost");
assert.equal(database.username, "nt_fixture");
assert.equal(database.pathname, "/nutritracker_test");
assert.match(database.searchParams.get("host") || "", /^\/.*\/nt-fixture-[a-f0-9]{12}\/socket$/);
const date = "2026-11-19";
const mealType = "DINNER" as const;
const ids: string[] = [];
const secret = process.env.AUTH_SECRET;
const feature = process.env.MCP_BUDDY_MEAL_LOGGING_ENABLED;
before(async () => {
  const [settings] = await prisma.$queryRaw<Array<{ listen: string }>>`SELECT current_setting('listen_addresses') AS listen`;
  assert.equal(settings.listen, "");
  process.env.AUTH_SECRET = "test-only-delegated-meal-token-secret-32482";
  process.env.MCP_BUDDY_MEAL_LOGGING_ENABLED = "true";
});
after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.food.deleteMany({ where: { createdByUserId: { in: ids } } });
  await prisma.$disconnect();
  if (secret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = secret;
  if (feature === undefined) delete process.env.MCP_BUDDY_MEAL_LOGGING_ENABLED; else process.env.MCP_BUDDY_MEAL_LOGGING_ENABLED = feature;
});

async function user() {
  const account = await prisma.user.create({ data: { username: "delegated-" + randomUUID(), passwordHash: "fixture-only" } });
  ids.push(account.id);
  return account;
}
async function fixture() {
  const [a, b] = await Promise.all([user(), user()]);
  const link = await prisma.buddyRelationship.create({ data: { requesterId: a.id, addresseeId: b.id, status: "ACCEPTED", addresseeAllowsMealLogging: true } });
  return { a, b, link };
}
async function recipe(actorId: string, recipientId: string) {
  const prepared = await prepareRecipe(actorId, { yield: { amount: 4, unit: "servings" }, nutrition: {
    basis: "whole_recipe", nutrients: { kcal: 1200, protein_g: 60, carbs_g: 120, fat_g: 24, fiber_g: 0 },
  } }, { date, mealType, mealName: "Dal", now: new Date() }, async () => { throw new Error("unexpected estimate"); });
  return { intent: { source: { kind: "recipe" as const, preparedRecipeToken: prepared.preparedRecipeToken }, recipientId, date, mealType,
    selfPortion: [{ unit: "servings" as const, amount: 1 }], buddyPortion: [{ unit: "servings" as const, amount: 1.5 }] }, recipeId: prepared.id };
}
type Intent = z.input<typeof PreviewBuddyMealSchema>;
async function inputFor(actorId: string, intent: Intent) {
  const { reviewToken } = await previewMcpBuddyMeal(actorId, intent);
  return { ...intent, reviewToken, requestId: randomUUID(), confirmed: true as const };
}
async function loggedPlate(actorId: string) {
  const food = await prisma.food.create({ data: { name: "Rice", createdByUserId: actorId, kcalPer100g: 100, proteinPer100g: 5, carbsPer100g: 20, fatPer100g: 0 } });
  return prisma.logEntry.create({ data: { userId: actorId, foodId: food.id, date, mealType, amount: 100,
    mealName: "private meal note", sourceText: "private medical detail", estimationMeta: { notes: "private", originalUnit: "private" } } });
}

test("a signed review saves two separate owner plates exactly once; corrections and revocation survive retries", async () => {
  const { a, b, link } = await fixture();
  const { intent } = await recipe(a.id, b.id);
  const preview = await previewMcpBuddyMeal(a.id, intent);
  assert.equal(preview.self?.totals.kcal, 300);
  assert.equal(preview.buddy.totals.protein_g, 22.5);
  const input = { ...intent, reviewToken: preview.reviewToken, requestId: randomUUID(), confirmed: true as const };
  await assert.rejects(commitMcpMeal(a.id, { preparedMealToken: intent.source.preparedRecipeToken }));
  await assert.rejects(logMcpBuddyMeal(a.id, { ...input, selfPortion: [{ amount: 0.5, unit: "servings" }] }), /review/i);
  const [first, second] = await Promise.all([logMcpBuddyMeal(a.id, input), logMcpBuddyMeal(a.id, input)]);
  assert.deepEqual(first, second);
  const [mine, hers] = await Promise.all([a.id, b.id].map(userId => prisma.logEntry.findFirstOrThrow({ where: { userId }, include: { batch: true } })));
  assert.equal(mine.snapshotKcal, 300); assert.equal(hers.snapshotKcal, 450); assert.equal(hers.snapshotFiberG, 0);
  assert.equal(hers.batch?.loggedByUsername, a.username); assert.equal(mine.batch?.loggedByUsername, null);
  assert.notEqual(mine.batchId, hers.batchId);
  await undoMcpMeal(a.id, { batchId: mine.batchId! });
  assert.equal(await prisma.logEntry.count({ where: { userId: b.id } }), 1);
  await undoMcpMeal(b.id, { batchId: hers.batchId! });
  await logMcpBuddyMeal(a.id, input);
  assert.equal((await logMcpBuddyMeal(a.id, { ...input, requestId: randomUUID() })).status, "previously_logged");
  await assert.rejects(logMcpBuddyMeal(a.id, { ...input, buddyPortion: [{ amount: 2, unit: "servings" }] }), /request ID/);
  assert.equal(await prisma.logEntry.count({ where: { userId: { in: [a.id, b.id] } } }), 0);
  await prisma.buddyRelationship.update({ where: { id: link.id }, data: { addresseeAllowsMealLogging: false } });
  await assert.rejects(logMcpBuddyMeal(a.id, input), /not enabled/);
});

test("permission is directional, restricted to accepted buddies, revocable, and gated on replay", async () => {
  const { a, b, link } = await fixture();
  const { intent: reverse } = await recipe(b.id, a.id);
  const request = await inputFor(b.id, reverse);
  assert.equal((await getMcpBuddyMeals(b.id)).buddies[0].mayLogMealsForBuddy, false);
  await assert.rejects(logMcpBuddyMeal(b.id, request), /not enabled/);
  await assert.rejects(previewMcpBuddyMeal(b.id, { ...reverse, recipientId: (await user()).id }), /connected buddy/);
  await prisma.buddyRelationship.update({ where: { id: link.id }, data: { status: "PENDING", requesterAllowsMealLogging: true } });
  await assert.rejects(logMcpBuddyMeal(b.id, request), /connected buddy/);
  await prisma.buddyRelationship.update({ where: { id: link.id }, data: { status: "ACCEPTED" } });
  await logMcpBuddyMeal(b.id, request);
  try {
    process.env.MCP_BUDDY_MEAL_LOGGING_ENABLED = "false";
    await assert.rejects(logMcpBuddyMeal(b.id, request), /unavailable/);
  } finally { process.env.MCP_BUDDY_MEAL_LOGGING_ENABLED = "true"; }
  await prisma.buddyRelationship.delete({ where: { id: link.id } });
  await assert.rejects(logMcpBuddyMeal(b.id, request), /connected buddy/);
});

test("fresh proposals need no self diary entry, and proposal acceptance and direct posting cannot double log", async () => {
  const { a, b } = await fixture();
  const { intent: both } = await recipe(a.id, b.id);
  const intent = { ...both, selfPortion: undefined };
  const direct = await inputFor(a.id, intent);
  const share = { source: intent.source, recipientId: b.id, date, mealType, buddyPortion: intent.buddyPortion, requestId: randomUUID(), confirmed: true as const };
  const sent = await shareMcpMeal(a.id, share);
  assert.equal(sent.status, "PENDING");
  assert.equal(await prisma.logEntry.count({ where: { userId: { in: [a.id, b.id] } } }), 0);
  await assert.rejects(logMcpBuddyMeal(a.id, direct), /waiting/);
  const results = await Promise.allSettled([
    respondMcpSharedMeal(b.id, { requestId: randomUUID(), proposalId: sent.proposalId, action: "accept", date, mealType }),
    logMcpBuddyMeal(a.id, direct),
  ]);
  assert.equal(results[0].status, "fulfilled");
  assert.equal((await logMcpBuddyMeal(a.id, direct)).status, "previously_logged");
  assert.equal((await shareMcpMeal(a.id, { ...share, requestId: randomUUID() })).status, "ACCEPTED");
  assert.equal(await prisma.logEntry.count({ where: { userId: b.id } }), 1);
  assert.equal(await prisma.logEntry.count({ where: { userId: a.id } }), 0);
});

test("logged entries and saved snapshots pin versions and support disjoint side portions and small amounts", async () => {
  const { a, b } = await fixture();
  const [main, side] = await Promise.all([loggedPlate(a.id), loggedPlate(a.id)]);
  const source = { kind: "entries" as const, entries: [main, side].map(row => ({ id: row.id, expectedUpdatedAt: row.updatedAt.toISOString() })) };
  const intent = { recipientId: b.id, date, mealType, source, buddyPortion: [
    { selectedItemIds: [main.id], amount: 0.125, unit: "reference" as const }, { selectedItemIds: [side.id], amount: 2, unit: "reference" as const },
  ] };
  const written = await inputFor(a.id, intent);
  await assert.rejects(previewMcpBuddyMeal(a.id, { ...intent, selfPortion: [{ amount: 1, unit: "reference" }] }), /already in your log/);
  await assert.rejects(previewMcpBuddyMeal(a.id, { ...intent, buddyPortion: [intent.buddyPortion[0], intent.buddyPortion[0]] }), /twice/);
  await logMcpBuddyMeal(a.id, written);
  const rows = await prisma.logEntry.findMany({ where: { userId: b.id }, orderBy: { amount: "asc" } });
  assert.deepEqual(rows.map(row => row.snapshotKcal), [12.5, 200]); assert.doesNotMatch(JSON.stringify(rows), /private/i);
  assert.equal(await prisma.logEntry.count({ where: { userId: a.id } }), 2);
  const librarySource = { kind: "entries" as const, entryIds: [main.id, side.id] };
  const preset = await saveMcpMealPreset(a.id, { requestId: randomUUID(), name: "Usual dinner", source: librarySource });
  const saved = { ...intent, source: { kind: "saved" as const, id: preset.id, expectedUpdatedAt: preset.updatedAt, occurrenceId: randomUUID() } };
  const savedRequest = await inputFor(a.id, saved);
  await prisma.savedMeal.update({ where: { id: preset.id }, data: { name: "Edited", updatedAt: new Date(Date.now() + 100) } });
  await assert.rejects(logMcpBuddyMeal(a.id, savedRequest), /changed/);
  await prisma.logEntry.update({ where: { id: main.id }, data: { amount: 110, updatedAt: new Date(Date.now() + 100) } });
  await assert.rejects(logMcpBuddyMeal(a.id, { ...written, requestId: randomUUID() }), /changed/);
});

test("a recipient write failure rolls back the cook, recipe foods, ledger and retry receipt", async () => {
  const { a, b } = await fixture();
  const { recipeId, intent } = await recipe(a.id, b.id);
  const request = await inputFor(a.id, intent);
  const identity = JSON.stringify([a.id, "recipe:" + recipeId]) + ":buddy";
  const occupied = await prisma.logBatch.create({ data: { userId: b.id, requestId: "mcp-buddy:" + createHash("sha256").update(identity).digest("hex"), kind: "fixture collision" } });
  await assert.rejects(logMcpBuddyMeal(a.id, request));
  assert.equal(await prisma.food.count({ where: { createdByUserId: a.id } }), 0);
  assert.equal(await prisma.logBatch.count({ where: { userId: a.id } }), 0);
  assert.equal(await prisma.mealProposal.count({ where: { senderId: a.id } }), 0);
  assert.equal(await prisma.mcpMutation.count({ where: { userId: a.id } }), 0);
  await prisma.logBatch.delete({ where: { id: occupied.id } });
  await logMcpBuddyMeal(a.id, request);
});

test("concurrent reciprocal saves complete; a write waiting behind a revocation sees the new grant", async () => {
  const { a, b, link } = await fixture();
  await prisma.buddyRelationship.update({ where: { id: link.id }, data: { requesterAllowsMealLogging: true } });
  const { intent: one } = await recipe(a.id, b.id);
  const { intent: two } = await recipe(b.id, a.id);
  const [ab, ba] = await Promise.all([inputFor(a.id, one), inputFor(b.id, two)]);
  await Promise.all([logMcpBuddyMeal(a.id, ab), logMcpBuddyMeal(b.id, ba)]);
  const { intent: another } = await recipe(a.id, b.id);
  const queued = await inputFor(a.id, another);
  let signalLocked!: () => void, allowCommit!: () => void;
  const locked = new Promise<void>(resolve => { signalLocked = resolve; });
  const release = new Promise<void>(resolve => { allowCommit = resolve; });
  const revoke = prisma.$transaction(async tx => {
    await tx.buddyRelationship.update({ where: { id: link.id }, data: { addresseeAllowsMealLogging: false } });
    signalLocked();
    await release;
  });
  await locked;
  const pending = assert.rejects(logMcpBuddyMeal(a.id, queued), /not enabled/);
  allowCommit();
  await Promise.all([revoke, pending]);
  assert.equal(await prisma.logEntry.count({ where: { userId: { in: [a.id, b.id] } } }), 4);
});

test("a second buddy can receive leftovers only within the same cooked yield", async () => {
  const { a, b } = await fixture();
  const c = await user();
  await prisma.buddyRelationship.create({ data: { requesterId: c.id, addresseeId: a.id, status: "ACCEPTED", requesterAllowsMealLogging: true } });
  const { intent: first } = await recipe(a.id, b.id);
  await logMcpBuddyMeal(a.id, await inputFor(a.id, first));
  const second = { ...first, selfPortion: undefined, recipientId: c.id };
  await assert.rejects(logMcpBuddyMeal(a.id, await inputFor(a.id, { ...second, buddyPortion: [{ unit: "servings", amount: 2 }] })), /exceed/);
  await logMcpBuddyMeal(a.id, await inputFor(a.id, second));
  assert.equal(await prisma.logEntry.count({ where: { userId: c.id } }), 1);
  assert.equal(await prisma.logEntry.count({ where: { userId: a.id } }), 1);
});

test("a shared saved preset preserves its pinned source and meal occurrence across a change of assistant", async () => {
  const { a, b } = await fixture();
  const entry = await loggedPlate(a.id);
  const saved = await saveMcpMealPreset(a.id, { requestId: randomUUID(), name: "Dal", source: { kind: "entries", entryIds: [entry.id] } });
  const intent = { source: { kind: "saved" as const, id: saved.id, expectedUpdatedAt: saved.updatedAt, occurrenceId: randomUUID() },
    recipientId: b.id, date, mealType, buddyPortion: [{ amount: 0.125, unit: "reference" as const }] };
  const request = await inputFor(a.id, intent);
  const sent = await shareMcpMeal(a.id, { ...intent, confirmed: true, requestId: randomUUID() });
  assert.equal(sent.status, "PENDING");
  await assert.rejects(logMcpBuddyMeal(a.id, request), /waiting/);
  await respondMcpSharedMeal(b.id, { requestId: randomUUID(), proposalId: sent.proposalId, action: "accept", date, mealType });
  assert.equal((await logMcpBuddyMeal(a.id, request)).status, "previously_logged");
  const portions = await prisma.logEntry.findMany({ where: { userId: b.id } });
  assert.deepEqual(portions.map(row => row.amount), [12.5]);
});

test("using only a selected entry from a larger shared plate cannot double-log it", async () => {
  const { a, b } = await fixture();
  const [dal, rice] = await Promise.all([loggedPlate(a.id), loggedPlate(a.id)]);
  await shareMcpMeal(a.id, { requestId: randomUUID(), recipientId: b.id, date, mealType, confirmed: true,
    source: { kind: "entries", entryIds: [dal.id, rice.id] }, selectedItemIds: [dal.id] });
  const intent = { source: { kind: "entries" as const, entries: [{ id: dal.id, expectedUpdatedAt: dal.updatedAt.toISOString() }] },
    recipientId: b.id, date, mealType, buddyPortion: [{ amount: 1, unit: "reference" as const }] };
  await assert.rejects(logMcpBuddyMeal(a.id, await inputFor(a.id, intent)), /waiting/);
  assert.equal(await prisma.logEntry.count({ where: { userId: b.id } }), 0);
});
