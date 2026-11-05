import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { decodeJwt, SignJWT } from "jose";
import { prisma } from "../lib/db";
import type { EstimateResponse } from "../lib/llm";
import {
  DayProgressSchema, McpNutritionError, PrepareMcpMealSchema, ProgressSchema,
  commitMcpMeal, getMcpAccount, getMcpDayProgress, getMcpProgress,
  mcpCalendarDate, prepareMcpMeal, undoMcpMeal,
} from "../lib/mcp-nutrition";

// Never read application configuration or connect to a real user's database.
const url = new URL(process.env.DATABASE_URL || "file:///missing-fixture-database");
assert.equal(url.protocol, "postgresql:", "Start the private fixture DB with scripts/test-db.mjs run");
assert.equal(url.hostname, "localhost");
assert.equal(url.username, "nt_fixture");
assert.equal(url.pathname, "/nutritracker_test");
assert.match(url.searchParams.get("host") || "", /^\/.*\/nt-fixture-[a-f0-9]{12}\/socket$/);

const userIds: string[] = [];
const date = "2026-11-04";
const originalSecret = process.env.AUTH_SECRET;
const fixtureSecret = "fixture-only-meal-signing-secret-0123456789";
const estimate: EstimateResponse = {
  items: [
    { description: "Two eggs", quantity: 100, unit: "g", assumptions: ["Two large eggs, 100 g total"], confidence: 0.9,
      nutrients: { kcal: 140, protein_g: 12, carbs_g: 1, fat_g: 10, fiber_g: 0 } },
    { description: "Toast", quantity: 40, unit: "g", assumptions: ["One slice, 40 g"], confidence: 0.8,
      nutrients: { kcal: 100, protein_g: 4, carbs_g: 20, fat_g: 1 } },
  ], notes: ["Cooking oil was not specified."],
};
const input = { description: "Two eggs and toast", date, mealType: "BREAKFAST" as const, mealName: "Breakfast" };
const fakeEstimator = async () => structuredClone(estimate);

before(async () => {
  const [settings] = await prisma.$queryRaw<Array<{ database: string; listen: string }>>`SELECT current_database() AS database, current_setting('listen_addresses') AS listen`;
  assert.equal(settings.database, "nutritracker_test");
  assert.equal(settings.listen, "", "Fixture PostgreSQL must not listen on TCP");
  process.env.AUTH_SECRET = fixtureSecret;
});

after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.food.deleteMany({ where: { createdByUserId: { in: userIds } } });
  await prisma.$disconnect();
  if (originalSecret === undefined) delete process.env.AUTH_SECRET;
  else process.env.AUTH_SECRET = originalSecret;
});

async function fixture() {
  const users = await Promise.all(["a", "b"].map(async (role) => {
    const user = await prisma.user.create({ data: {
      username: `mcp-fixture-${role}-${randomUUID()}`, passwordHash: "fixture-no-login",
      profile: { create: { kcalTarget: role === "a" ? 2100 : 1800, allergies: ["private allergy"], healthConditions: ["private medical history"] } },
    } });
    userIds.push(user.id);
    return user;
  }));
  return { a: users[0], b: users[1] };
}

async function preview(userId: string) {
  return prepareMcpMeal(userId, input, { client: prisma, estimate: fakeEstimator });
}

async function resign(token: string, transform: (payload: ReturnType<typeof decodeJwt>) => ReturnType<typeof decodeJwt>) {
  const key = createHmac("sha256", fixtureSecret).update("nutritracker:mcp:prepared-meal:v1").digest();
  return new SignJWT(transform(decodeJwt(token))).setProtectedHeader({ alg: "HS256", typ: "nt-prepared-meal+jwt" }).sign(key);
}

test("MCP preview does not write, and concurrently retried saves preserve server estimates exactly once", async () => {
  const { a } = await fixture();
  let calls = 0;
  const prepared = await prepareMcpMeal(a.id, input, { client: prisma, estimate: async ({ text }) => {
    assert.equal(text, input.description); calls++; return structuredClone(estimate);
  } });
  assert.equal(prepared.saved, false);
  assert.equal(prepared.username, a.username);
  assert.deepEqual(prepared.estimatedTotals, { kcal: 240, protein_g: 16, carbs_g: 21, fat_g: 11, fiber_g: 0 });
  assert.equal(await prisma.logEntry.count({ where: { userId: a.id } }), 0);
  assert.equal(await prisma.food.count({ where: { createdByUserId: a.id } }), 0);
  const saved = await Promise.all(Array.from({ length: 5 }, () => commitMcpMeal(a.id, { preparedMealToken: prepared.preparedMealToken }, prisma)));
  assert.equal(new Set(saved.map((result) => result.batchId)).size, 1);
  assert.equal(calls, 1, "Commit must not call the estimator again");
  assert.equal(await prisma.logBatch.count({ where: { userId: a.id } }), 1);
  assert.equal(await prisma.food.count({ where: { createdByUserId: a.id } }), 2);
  const entries = await prisma.logEntry.findMany({ where: { batchId: saved[0].batchId }, include: { food: true } });
  assert.equal(entries.length, 2);
  assert.ok(entries.every((entry) => entry.userId === a.id && entry.date === date && entry.mealType === "BREAKFAST" && entry.sourceText === input.description));
  const eggs = entries.find((entry) => entry.food.name === "Two eggs")!;
  assert.equal(eggs.snapshotKcal, 140);
  assert.equal(eggs.amount, 100);
  assert.deepEqual((eggs.estimationMeta as { assumptions: string[] }).assumptions, estimate.items[0].assumptions);
  assert.deepEqual(saved[0].dayProgress.totals, prepared.estimatedTotals);
  assert.equal(saved[0].dayProgress.entriesMissingFiber, 1);
  assert.equal(saved[0].dayProgress.remaining?.kcal, 1860);
  assert.equal(saved[0].dayProgress.remaining?.fiber_g, null);
  assert.equal(saved[0].dayProgress.nutritionCompleteForRecordedEntries, true);
  assert.equal(saved[0].dayProgress.fiberCompleteForRecordedEntries, false);
  assert.ok(saved.every((result) => result.saved && result.entryCount === 2));
});

test("separate accounts cannot read, commit, or undo each other's meals or expose medical profiles", async () => {
  const { a, b } = await fixture();
  const prepared = await preview(a.id);
  await assert.rejects(commitMcpMeal(b.id, { preparedMealToken: prepared.preparedMealToken }, prisma), /another account/);
  const saved = await commitMcpMeal(a.id, { preparedMealToken: prepared.preparedMealToken }, prisma);
  await assert.rejects(undoMcpMeal(b.id, { batchId: saved.batchId }, prisma), /not found in your account/);
  const aDay = await getMcpDayProgress(a.id, { date }, prisma);
  const bDay = await getMcpDayProgress(b.id, { date }, prisma);
  assert.equal(aDay.entries.length, 2);
  assert.equal(bDay.entries.length, 0);
  assert.equal(bDay.totals.kcal, 0);
  assert.equal(bDay.targets.kcal, 1800);
  assert.equal((await getMcpProgress(b.id, { endDate: date, days: 7 }, prisma)).loggedDays, 0);
  const account = await getMcpAccount(a.id, prisma);
  assert.equal(account.username, a.username);
  assert.equal(account.timezoneSource, "website_default");
  assert.equal(account.timezone, "America/Los_Angeles");
  assert.doesNotMatch(JSON.stringify({ account, aDay, bDay }), /private allergy|private medical history|passwordHash|healthConditions|allergies/);
  const other = await preview(b.id);
  await commitMcpMeal(b.id, { preparedMealToken: other.preparedMealToken }, prisma);
  assert.equal((await getMcpDayProgress(a.id, { date }, prisma)).entryCount, 2);
  assert.equal((await getMcpDayProgress(b.id, { date }, prisma)).entryCount, 2);
});

test("tampered, expired unsaved, and future preview tokens cannot create entries", async () => {
  const { a } = await fixture();
  const prepared = await preview(a.id);
  const parts = prepared.preparedMealToken.split(".");
  const payload = decodeJwt(prepared.preparedMealToken);
  const alteredMeal = { ...(payload.meal as object), date: "2026-11-03" };
  parts[1] = Buffer.from(JSON.stringify({ ...payload, meal: alteredMeal })).toString("base64url");
  await assert.rejects(commitMcpMeal(a.id, { preparedMealToken: parts.join(".") }, prisma), /invalid/);
  const expired = await prepareMcpMeal(a.id, input, { client: prisma, estimate: fakeEstimator, now: new Date(Date.now() - 2 * 60 * 60 * 1000) });
  await assert.rejects(commitMcpMeal(a.id, { preparedMealToken: expired.preparedMealToken }, prisma), /expired/);
  const future = await prepareMcpMeal(a.id, input, { client: prisma, estimate: fakeEstimator, now: new Date(Date.now() + 2 * 60 * 60 * 1000) });
  await assert.rejects(commitMcpMeal(a.id, { preparedMealToken: future.preparedMealToken }, prisma), /invalid/);
  assert.equal(await prisma.logEntry.count({ where: { userId: a.id } }), 0);
  assert.equal(await prisma.food.count({ where: { createdByUserId: a.id } }), 0);
});

test("delayed save retries return the existing receipt; Undo tombstones prevent resurrection even after preview expiry", async () => {
  const { a } = await fixture();
  const prepared = await preview(a.id);
  const saved = await commitMcpMeal(a.id, { preparedMealToken: prepared.preparedMealToken }, prisma);
  // Simulate the same preview's age without changing global clocks for concurrent tests.
  const expired = await resign(prepared.preparedMealToken, (payload) => ({ ...payload, iat: payload.iat! - 7200, exp: payload.exp! - 7200 }));
  const delayed = await commitMcpMeal(a.id, { preparedMealToken: expired }, prisma);
  assert.equal(delayed.batchId, saved.batchId);
  assert.equal(delayed.alreadySaved, true);
  assert.equal(delayed.dayProgress.totals.kcal, 240);
  const undone = await undoMcpMeal(a.id, { batchId: saved.batchId }, prisma);
  assert.equal(undone.entryCount, 2);
  assert.equal(undone.dayProgress.totals.kcal, 0);
  assert.equal((await undoMcpMeal(a.id, { batchId: saved.batchId }, prisma)).entryCount, 0);
  for (const token of [prepared.preparedMealToken, expired]) {
    const retry = await commitMcpMeal(a.id, { preparedMealToken: token }, prisma);
    assert.equal(retry.undone, true);
    assert.equal(retry.saved, false);
    assert.equal(retry.entryCount, 0);
    assert.equal(retry.dayProgress.totals.kcal, 0);
  }
  assert.equal(await prisma.logEntry.count({ where: { userId: a.id } }), 0);
  assert.equal(await prisma.logBatch.count({ where: { userId: a.id } }), 1);
});

test("an expired Undo gives actionable guidance and preserves the meal", async () => {
  const { a } = await fixture();
  const prepared = await preview(a.id);
  const saved = await commitMcpMeal(a.id, { preparedMealToken: prepared.preparedMealToken }, prisma);
  await prisma.logBatch.update({ where: { id: saved.batchId }, data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) } });
  await assert.rejects(undoMcpMeal(a.id, { batchId: saved.batchId }, prisma),
    (error: unknown) => error instanceof McpNutritionError && error.message.includes("24 hours"));
  assert.equal(await prisma.logEntry.count({ where: { batchId: saved.batchId } }), 2);
});

test("a signed preview with reused request ID but different immutable contents is rejected", async () => {
  const { a } = await fixture();
  const prepared = await preview(a.id);
  await commitMcpMeal(a.id, { preparedMealToken: prepared.preparedMealToken }, prisma);
  const changed = await resign(prepared.preparedMealToken, (payload) => ({ ...payload, meal: { ...(payload.meal as object), date: "2026-11-03" } }));
  await assert.rejects(commitMcpMeal(a.id, { preparedMealToken: changed }, prisma), /already used/);
  assert.equal(await prisma.logEntry.count({ where: { userId: a.id } }), 2);
  assert.equal(await prisma.logEntry.count({ where: { userId: a.id, date: "2026-11-03" } }), 0);
});

test("daily and range totals preserve zero snapshots, expose missing nutrition, and do not imply complete logging", async () => {
  const { a } = await fixture();
  const prepared = await preview(a.id);
  await commitMcpMeal(a.id, { preparedMealToken: prepared.preparedMealToken }, prisma);
  const food = await prisma.food.create({ data: { name: "Legacy unknown serving", createdByUserId: a.id,
    kcalPer100g: 999, proteinPer100g: 999, carbsPer100g: 999, fatPer100g: 999, nutritionBasis: "GRAMS" } });
  await prisma.logEntry.create({ data: { userId: a.id, foodId: food.id, date, mealType: "LUNCH", amount: 1, unit: "SERVING" } });
  await prisma.logEntry.create({ data: { userId: a.id, foodId: food.id, date: "2026-11-02", mealType: "SNACK", amount: 100, unit: "GRAM",
    snapshotKcal: 0, snapshotProteinG: 0, snapshotCarbsG: 0, snapshotFatG: 0, snapshotFiberG: 0 } });
  await prisma.waterEntry.create({ data: { userId: a.id, date, glasses: 3 } });
  await prisma.workoutEntry.create({ data: { userId: a.id, date, exerciseName: "Walk", caloriesBurned: 75, isEstimated: true } });
  const day = await getMcpDayProgress(a.id, { date }, prisma);
  assert.equal(day.entryCount, 3);
  assert.equal(day.entriesWithNutrition, 2);
  assert.equal(day.entriesMissingNutrition, 1);
  assert.equal(day.entriesMissingFiber, 2);
  assert.equal(day.totals.kcal, 240);
  assert.equal(day.remaining, null, "Missing nutrition must not create a misleading remaining-food budget");
  assert.equal(day.nutritionCompleteForRecordedEntries, false);
  assert.equal(day.fiberCompleteForRecordedEntries, false);
  assert.equal(day.waterGlasses, 3);
  assert.deepEqual(day.workouts, { count: 1, estimatedCaloriesBurned: 75, entriesMissingCalories: 0 });
  const progress = await getMcpProgress(a.id, { endDate: date, days: 7 }, prisma);
  assert.equal(progress.startDate, "2026-10-29");
  assert.equal(progress.daily.length, 7, "Calendar range crosses daylight-saving transition without skipping a date");
  assert.equal(progress.loggedDays, 2);
  assert.equal(progress.unloggedDays, 5);
  assert.equal(progress.totals.kcal, 240);
  assert.equal(progress.nutritionCompleteForRecordedEntries, false);
  assert.equal(progress.fiberCompleteForRecordedEntries, false);
  assert.equal(progress.averagesPerLoggedDay?.kcal, 120);
  assert.equal(progress.daily.find((value) => value.date === "2026-11-02")?.entriesWithNutrition, 1);
  assert.equal(progress.daily.find((value) => value.date === "2026-11-01")?.entryCount, 0);
  assert.match(progress.coverageNote, /unknown/);
});

test("invalid estimates and provider errors expose safe messages and save nothing", async () => {
  const { a } = await fixture();
  await assert.rejects(prepareMcpMeal(a.id, input, { client: prisma, estimate: async () => { throw new Error("secret-provider-response"); } }),
    (error: unknown) => error instanceof McpNutritionError && !error.message.includes("secret-provider-response") && error.message.includes("Nothing was saved"));
  const invalid = structuredClone(estimate);
  invalid.items[0].nutrients.kcal = -1;
  await assert.rejects(prepareMcpMeal(a.id, input, { client: prisma, estimate: async () => invalid }), /could not estimate/);
  assert.equal(await prisma.logEntry.count({ where: { userId: a.id } }), 0);
  assert.equal(await prisma.food.count({ where: { createdByUserId: a.id } }), 0);
});

test("calendar defaults and strict tool schemas reject implicit identity, invalid dates and unbounded ranges", () => {
  const now = new Date("2026-11-05T07:30:00.000Z");
  assert.equal(mcpCalendarDate(undefined, now), "2026-11-04");
  assert.equal(mcpCalendarDate("UTC", now), "2026-11-05");
  assert.equal(DayProgressSchema.safeParse({ date: "2026-02-30" }).success, false);
  assert.equal(DayProgressSchema.safeParse({ timezone: "Wrong/Zone" }).success, false);
  assert.equal(ProgressSchema.safeParse({ days: 32 }).success, false);
  assert.equal(PrepareMcpMealSchema.safeParse({ ...input, userId: "someone-else" }).success, false);
});
