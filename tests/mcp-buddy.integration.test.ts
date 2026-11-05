import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "../lib/db";
import { BuddyDaySchema, getMcpBuddyDay } from "../lib/mcp-buddy";

const database = new URL(process.env.DATABASE_URL || "file:///missing-fixture");
assert.equal(database.hostname, "localhost"); assert.equal(database.username, "nt_fixture");
assert.equal(database.pathname, "/nutritracker_test");
assert.match(database.searchParams.get("host") || "", /^\/.*\/nt-fixture-[a-f0-9]{12}\/socket$/);
const ids: string[] = [];
const date = "2026-11-04";
before(async () => {
  const [settings] = await prisma.$queryRaw<Array<{ database: string; listen: string }>>`SELECT current_database() AS database, current_setting('listen_addresses') AS listen`;
  assert.equal(settings.database, "nutritracker_test"); assert.equal(settings.listen, "");
});
after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.food.deleteMany({ where: { createdByUserId: { in: ids } } });
  await prisma.$disconnect();
});
async function fixture() {
  const users = await Promise.all(["a", "b", "c"].map(async role => {
    const user = await prisma.user.create({ data: { username: `buddy-fixture-${role}-${randomUUID()}`, passwordHash: "private-login-hash", profile: { create: { allergies: ["private-allergy"], healthConditions: ["private-health"], weightKg: 79 } } } });
    ids.push(user.id); return user;
  }));
  const [a, b, c] = users;
  const food = await prisma.food.create({ data: { name: "Fixture meal", createdByUserId: b.id, kcalPer100g: 100, proteinPer100g: 10, carbsPer100g: 20, fatPer100g: 3 } });
  await prisma.logEntry.create({ data: { userId: b.id, foodId: food.id, date, mealType: "LUNCH", amount: 100,
    snapshotKcal: 100, snapshotProteinG: 10, snapshotCarbsG: 20, snapshotFatG: 3, snapshotFiberG: 0,
    sourceText: "private-whole-day-description", estimationMeta: { private: "private-estimate-metadata" } } });
  await prisma.workoutEntry.create({ data: { userId: b.id, date, exerciseName: "Squat", sets: 3, reps: 8, weightKg: 40, caloriesBurned: null,
    sourceText: "private-workout-description", estimationMeta: { private: "private-workout-metadata" } } });
  await prisma.waterEntry.create({ data: { userId: b.id, date, glasses: 9 } });
  await prisma.weightEntry.create({ data: { userId: b.id, date, weightKg: 79 } });
  return { a, b, c, food };
}

test("accepted buddies in either direction can read daily foods and workouts with explicit field redaction", async () => {
  for (const reverse of [false, true]) {
    const { a, b } = await fixture();
    await prisma.buddyRelationship.create({ data: { requesterId: reverse ? b.id : a.id, addresseeId: reverse ? a.id : b.id, status: "ACCEPTED" } });
    const result = await getMcpBuddyDay(a.id, { date });
    assert.equal(result.buddy.id, b.id); assert.equal(result.buddy.username, b.username);
    assert.equal(result.entries.length, 1); assert.equal(result.workouts.length, 1);
    assert.equal(result.totals.kcal, 100); assert.equal(result.totals.fiber_g, 0);
    assert.equal(result.workouts[0].weightKg, 40); assert.equal(result.workouts[0].caloriesBurned, null);
    assert.equal(result.workoutsMissingCalories, 1);
    assert.doesNotMatch(JSON.stringify(result), /private-|passwordHash|sourceText|estimationMeta|allergies|healthConditions|waterGlasses|"glasses"|"profile"|"weightKg":79/);
    const backwards = await getMcpBuddyDay(b.id, { buddyId: a.id, date });
    assert.equal(backwards.buddy.id, a.id); assert.equal(backwards.entries.length, 0);
  }
});

test("pending, declined, removed and unrelated accounts receive the same unavailable error", async () => {
  const { a, b, c } = await fixture();
  const errorMessage = async (buddyId: string) => {
    try { await getMcpBuddyDay(a.id, { buddyId, date }); return "unexpected-success"; }
    catch (error) { return (error as Error).message; }
  };
  const absent = await errorMessage("missing-fixture-user");
  assert.equal(await errorMessage(b.id), absent);
  const relation = await prisma.buddyRelationship.create({ data: { requesterId: a.id, addresseeId: b.id, status: "PENDING" } });
  assert.equal(await errorMessage(b.id), absent);
  await prisma.buddyRelationship.update({ where: { id: relation.id }, data: { status: "DECLINED" } });
  assert.equal(await errorMessage(b.id), absent);
  await prisma.buddyRelationship.update({ where: { id: relation.id }, data: { status: "ACCEPTED" } });
  assert.equal((await getMcpBuddyDay(a.id, { buddyId: b.id, date })).entries.length, 1);
  assert.equal(await errorMessage(c.id), absent);
  await prisma.buddyRelationship.delete({ where: { id: relation.id } });
  assert.equal(await errorMessage(b.id), absent);
  assert.equal(await errorMessage(a.id), absent);
});

test("multiple buddies require explicit selection, while duplicate reciprocal links do not create ambiguity", async () => {
  const { a, b, c } = await fixture();
  await prisma.buddyRelationship.createMany({ data: [
    { requesterId: a.id, addresseeId: b.id, status: "ACCEPTED" },
    { requesterId: b.id, addresseeId: a.id, status: "ACCEPTED" },
  ] });
  assert.equal((await getMcpBuddyDay(a.id, { date })).buddy.id, b.id);
  await prisma.buddyRelationship.create({ data: { requesterId: a.id, addresseeId: c.id, status: "ACCEPTED" } });
  await assert.rejects(getMcpBuddyDay(a.id, { date }), /More than one buddy/);
  assert.equal((await getMcpBuddyDay(a.id, { buddyId: b.id, date })).buddy.id, b.id);
  assert.equal((await getMcpBuddyDay(a.id, { buddyId: c.id, date })).buddy.id, c.id);
});

test("daily totals preserve zero snapshots and mark unknown nutrition/calories without mixing other dates", async () => {
  const { a, b, food } = await fixture();
  await prisma.buddyRelationship.create({ data: { requesterId: a.id, addresseeId: b.id, status: "ACCEPTED" } });
  await prisma.logEntry.createMany({ data: [
    { userId: b.id, foodId: food.id, date, mealType: "SNACK", amount: 1, unit: "SERVING" },
    { userId: b.id, foodId: food.id, date, mealType: "SNACK", amount: 100, snapshotKcal: 0, snapshotProteinG: 0, snapshotCarbsG: 0, snapshotFatG: 0 },
    { userId: b.id, foodId: food.id, date: "2026-11-03", mealType: "LUNCH", amount: 500 },
  ] });
  await prisma.workoutEntry.createMany({ data: [
    { userId: b.id, date, exerciseName: "Walk", durationMinutes: 10, caloriesBurned: 0, isEstimated: true },
    { userId: b.id, date: "2026-11-03", exerciseName: "Run", durationMinutes: 20, caloriesBurned: 200, isEstimated: true },
  ] });
  const result = await getMcpBuddyDay(a.id, { date });
  assert.equal(result.entries.length, 3); assert.equal(result.totals.kcal, 100);
  assert.equal(result.entriesMissingNutrition, 1); assert.equal(result.entriesMissingFiber, 2);
  assert.equal(result.nutritionCompleteForRecordedEntries, false); assert.equal(result.fiberCompleteForRecordedEntries, false);
  assert.equal(result.workouts.length, 2); assert.equal(result.knownEstimatedCaloriesBurned, 0); assert.equal(result.workoutsMissingCalories, 1);
  const previous = await getMcpBuddyDay(a.id, { date: "2026-11-03" });
  assert.equal(previous.entries.length, 1); assert.equal(previous.totals.kcal, 500); assert.equal(previous.knownEstimatedCaloriesBurned, 200);
});

test("oversized buddy days expose bounded records and partial-total coverage", async () => {
  const { a, b, food } = await fixture();
  await prisma.buddyRelationship.create({ data: { requesterId: a.id, addresseeId: b.id, status: "ACCEPTED" } });
  await prisma.logEntry.createMany({ data: Array.from({ length: 201 }, () => ({ userId: b.id, foodId: food.id, date, mealType: "LUNCH" as const, amount: 100 })) });
  await prisma.workoutEntry.createMany({ data: Array.from({ length: 201 }, () => ({ userId: b.id, date, exerciseName: "Fixture walk", caloriesBurned: 10 })) });
  const result = await getMcpBuddyDay(a.id, { date });
  assert.equal(result.entries.length, 200); assert.equal(result.workouts.length, 200);
  assert.equal(result.entriesTruncated, true); assert.equal(result.workoutsTruncated, true);
  assert.equal(result.totalsScope, "returned_entries_only"); assert.equal(result.workoutTotalsScope, "returned_entries_only");
  assert.equal(result.nutritionCompleteForRecordedEntries, false);
});

test("buddy-day input rejects arbitrary identity and malformed dates", () => {
  assert.equal(BuddyDaySchema.safeParse({ userId: "someone" }).success, false);
  assert.equal(BuddyDaySchema.safeParse({ buddyId: "" }).success, false);
  assert.equal(BuddyDaySchema.safeParse({ date: "2026-02-30" }).success, false);
});

test("buddy removal waits for an authorized in-flight read and blocks every later read", async () => {
  const { a, b } = await fixture();
  const relation = await prisma.buddyRelationship.create({ data: { requesterId: a.id, addresseeId: b.id, status: "ACCEPTED" } });
  let releaseRead!: () => void;
  let readReached!: () => void;
  const paused = new Promise<void>(resolve => { releaseRead = resolve; });
  const reached = new Promise<void>(resolve => { readReached = resolve; });
  const client = prisma.$extends({ query: { logEntry: { async findMany({ args, query }) {
    readReached(); await paused; return query(args);
  } } } });
  const reading = getMcpBuddyDay(a.id, { date }, client as unknown as PrismaClient);
  await reached;
  let deletingStarted!: () => void;
  const started = new Promise<void>(resolve => { deletingStarted = resolve; });
  let deletingPid = 0;
  const deleting = prisma.$transaction(async tx => {
    const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
    deletingPid = pid; deletingStarted();
    await tx.buddyRelationship.delete({ where: { id: relation.id } });
  });
  try {
    await started;
    let blockedByRead = false;
    for (let attempt = 0; attempt < 100 && !blockedByRead; attempt++) {
      const rows = await prisma.$queryRaw<Array<{ wait_event_type: string | null }>>`SELECT wait_event_type FROM pg_stat_activity WHERE pid = ${deletingPid}`;
      blockedByRead = rows.some(row => row.wait_event_type === "Lock");
      if (!blockedByRead) await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.equal(blockedByRead, true, "The authorized read must hold the accepted-relationship lock until it completes.");
  } finally { releaseRead(); }
  assert.equal((await reading).buddy.id, b.id);
  await deleting;
  await assert.rejects(getMcpBuddyDay(a.id, { buddyId: b.id, date }), /not available/);
});
