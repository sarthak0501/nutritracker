import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../lib/db";
import {
  LogWorkoutSchema, MeasurementsSchema, SetWaterSchema, UpdateWorkoutSchema, WorkoutHistorySchema,
  deleteMcpWeight, deleteMcpWorkout, getMcpMeasurements, getMcpWorkouts, logMcpWorkout,
  setMcpWater, setMcpWeight, updateMcpWorkout,
} from "../lib/mcp-activity";

const url = new URL(process.env.DATABASE_URL || "file:///missing-fixture-database");
assert.equal(url.protocol, "postgresql:");
assert.equal(url.hostname, "localhost");
assert.equal(url.username, "nt_fixture");
assert.equal(url.pathname, "/nutritracker_test");
assert.match(url.searchParams.get("host") || "", /^\/.*\/nt-fixture-[a-f0-9]{12}\/socket$/);
const userIds: string[] = [];
const date = "2026-10-30";
const requestId = () => randomUUID();

before(async () => {
  const [settings] = await prisma.$queryRaw<Array<{ database: string; listen: string }>>`SELECT current_database() AS database, current_setting('listen_addresses') AS listen`;
  assert.equal(settings.database, "nutritracker_test");
  assert.equal(settings.listen, "");
});
after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});
async function fixture() {
  const users = await Promise.all(["a", "b"].map(async role => {
    const user = await prisma.user.create({ data: { username: `activity-fixture-${role}-${randomUUID()}`, passwordHash: "fixture-no-login", profile: { create: { healthConditions: ["private medical history"] } } } });
    userIds.push(user.id);
    return user;
  }));
  return { a: users[0], b: users[1] };
}
const exercise = { exerciseName: "Bench press", sets: 3, reps: 10, weightKg: 40 };

test("completed workouts preserve explicit fields, unknown calories, retry receipts and account isolation", async () => {
  const { a, b } = await fixture();
  const input = { requestId: requestId(), date, completed: true as const, exercises: [exercise, { exerciseName: "Walk", durationMinutes: 30, caloriesBurned: 120 }] };
  const results = await Promise.all(Array.from({ length: 4 }, () => logMcpWorkout(a.id, input)));
  for (const value of results) assert.deepEqual(value, results[0]);
  assert.equal(await prisma.workoutEntry.count({ where: { userId: a.id } }), 2);
  assert.equal(results[0].entries[0].caloriesBurned, null);
  assert.equal(results[0].entries[0].caloriesAreEstimated, false);
  assert.equal(results[0].entries[1].caloriesAreEstimated, true);
  const history = await getMcpWorkouts(a.id, { endDate: date, days: 7 });
  assert.equal(history.exerciseEntryCount, 2);
  assert.equal(history.recordedDays, 1);
  assert.equal(history.knownEstimatedCaloriesBurned, 120);
  assert.equal(history.entriesMissingCalories, 1);
  assert.equal(history.entriesMissingDuration, 1);
  assert.equal((await getMcpWorkouts(b.id, { endDate: date, days: 7 })).entries.length, 0);
  assert.ok(!JSON.stringify(history).includes("private medical history"));
  await assert.rejects(logMcpWorkout(a.id, { ...input, exercises: [{ ...exercise, reps: 12 }] }), /request ID/);
});

test("workout corrections and deletion require ownership and a fresh revision; old retries never restore records", async () => {
  const { a, b } = await fixture();
  const input = { requestId: requestId(), date, completed: true as const, exercises: [exercise] };
  const logged = await logMcpWorkout(a.id, input);
  const entry = logged.entries[0];
  const correction = { requestId: requestId(), entryId: entry.id, expectedUpdatedAt: entry.updatedAt, changes: { weightKg: 30 } };
  await assert.rejects(updateMcpWorkout(b.id, correction), /unavailable/);
  const corrected = await updateMcpWorkout(a.id, correction);
  assert.equal(corrected.entry.weightKg, 30);
  assert.notEqual(corrected.entry.updatedAt, entry.updatedAt);
  await assert.rejects(updateMcpWorkout(a.id, { ...correction, requestId: requestId(), changes: { weightKg: 90 } }), /changed/);
  await assert.rejects(deleteMcpWorkout(a.id, { requestId: requestId(), entryId: entry.id, expectedUpdatedAt: entry.updatedAt }), /changed/);
  await assert.rejects(deleteMcpWorkout(b.id, { requestId: requestId(), entryId: entry.id, expectedUpdatedAt: corrected.entry.updatedAt }), /unavailable/);
  const deletion = { requestId: requestId(), entryId: entry.id, expectedUpdatedAt: corrected.entry.updatedAt };
  assert.equal((await deleteMcpWorkout(a.id, deletion)).deleted, true);
  assert.equal((await deleteMcpWorkout(a.id, deletion)).deleted, true);
  await logMcpWorkout(a.id, input);
  await updateMcpWorkout(a.id, correction);
  assert.equal(await prisma.workoutEntry.count({ where: { userId: a.id } }), 0);
});

test("a mid-session database failure rolls back every exercise and its retry receipt", async () => {
  const { a } = await fixture();
  let inserts = 0;
  const failing = new Proxy(prisma, { get(target, key) {
    if (key !== "$transaction") return Reflect.get(target, key);
    return (writer: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) => target.$transaction(async tx => {
      const exercises = new Proxy(tx.workoutEntry, { get(delegate, name) {
        if (name !== "create") return Reflect.get(delegate, name);
        return async (args: Prisma.WorkoutEntryCreateArgs) => {
          if (++inserts === 2) throw new Error("fixture forced second exercise failure");
          return delegate.create(args);
        };
      } });
      return writer(new Proxy(tx, { get(value, name) { return name === "workoutEntry" ? exercises : Reflect.get(value, name); } }));
    }, options);
  } }) as PrismaClient;
  const input = { requestId: requestId(), date, completed: true as const, exercises: [exercise, exercise] };
  await assert.rejects(logMcpWorkout(a.id, input, failing), /fixture forced/);
  assert.equal(await prisma.workoutEntry.count({ where: { userId: a.id } }), 0);
  assert.equal(await prisma.mcpMutation.count({ where: { userId: a.id, requestId: input.requestId } }), 0);
  assert.equal((await logMcpWorkout(a.id, input)).entries.length, 2);
});

test("workout history has bounded truthful summaries, name filters and explicit truncation", async () => {
  const { a } = await fixture();
  await logMcpWorkout(a.id, { requestId: requestId(), date, completed: true, exercises: [exercise, { exerciseName: "Walk", durationMinutes: 30 }, { ...exercise, weightKg: 45 }] });
  const limited = await getMcpWorkouts(a.id, { endDate: date, days: 1, limit: 1 });
  assert.equal(limited.truncated, true);
  assert.equal(limited.exerciseEntryCount, 1);
  assert.equal(limited.summaryScope, "returned_entries_only");
  const filtered = await getMcpWorkouts(a.id, { endDate: date, days: 1, exerciseName: "BENCH" });
  assert.equal(filtered.entries.length, 2);
  assert.equal(filtered.truncated, false);
  assert.equal(filtered.entriesMissingCalories, 2);
  assert.equal(filtered.knownEstimatedCaloriesBurned, 0);
  assert.match(filtered.coverageNote, /unknown, not zero/);
  assert.equal((await getMcpWorkouts(a.id, { endDate: "2026-10-29", days: 1 })).entries.length, 0);
});

test("water uses absolute totals, stale-value protection and account-scoped duplicate-safe writes", async () => {
  const { a, b } = await fixture();
  const input = { requestId: requestId(), date, glasses: 2, expectedGlasses: 0 };
  await Promise.all(Array.from({ length: 4 }, () => setMcpWater(a.id, input)));
  assert.equal((await getMcpMeasurements(a.id, { endDate: date, days: 1 })).water[0].glasses, 2);
  await assert.rejects(setMcpWater(a.id, { ...input, requestId: requestId(), glasses: 4 }), /changed/);
  await setMcpWater(a.id, { ...input, requestId: requestId(), glasses: 4, expectedGlasses: 2 });
  await setMcpWater(a.id, input);
  assert.equal((await getMcpMeasurements(a.id, { endDate: date, days: 1 })).water[0].glasses, 4);
  assert.deepEqual((await getMcpMeasurements(b.id, { endDate: date, days: 1 })).water, []);
  await setMcpWater(b.id, input);
  assert.equal((await getMcpMeasurements(b.id, { endDate: date, days: 1 })).water[0].glasses, 2);
});

test("weight history corrections and deletion preserve profile settings and independent accounts", async () => {
  const { a, b } = await fixture();
  await prisma.profile.update({ where: { userId: a.id }, data: { weightKg: 80, kcalTarget: 2150 } });
  const older = { requestId: requestId(), date: "2026-10-29", weightKg: 76, expectedWeightKg: null };
  await setMcpWeight(a.id, older);
  const current = { requestId: requestId(), date, weightKg: 75, expectedWeightKg: null };
  await setMcpWeight(a.id, current);
  await setMcpWeight(a.id, { requestId: requestId(), date: older.date, weightKg: 77, expectedWeightKg: 76 });
  assert.equal((await prisma.profile.findUniqueOrThrow({ where: { userId: a.id } })).weightKg, 80);
  await assert.rejects(setMcpWeight(a.id, { ...current, requestId: requestId(), weightKg: 73 }), /changed/);
  await assert.rejects(deleteMcpWeight(b.id, { requestId: requestId(), date, expectedWeightKg: 75 }), /unavailable/);
  const deletion = { requestId: requestId(), date, expectedWeightKg: 75 };
  await deleteMcpWeight(a.id, deletion);
  await deleteMcpWeight(a.id, deletion);
  await setMcpWeight(a.id, current);
  assert.equal((await prisma.profile.findUniqueOrThrow({ where: { userId: a.id } })).weightKg, 80);
  const measurements = await getMcpMeasurements(a.id, { endDate: date, days: 2 });
  assert.deepEqual(measurements.weight, [{ date: older.date, weightKg: 77 }]);
  assert.deepEqual((await getMcpMeasurements(b.id, { endDate: date, days: 2 })).weight, []);
  await deleteMcpWeight(a.id, { requestId: requestId(), date: older.date, expectedWeightKg: 77 });
  const profile = await prisma.profile.findUniqueOrThrow({ where: { userId: a.id } });
  assert.equal(profile.weightKg, 80);
  assert.equal(profile.kcalTarget, 2150);
});

test("strict activity schemas reject implicit identities, plans, missing details, nonfinite values and oversized ranges", async () => {
  assert.equal(LogWorkoutSchema.safeParse({ requestId: requestId(), date, completed: false, exercises: [exercise] }).success, false);
  assert.equal(LogWorkoutSchema.safeParse({ requestId: requestId(), date, completed: true, exercises: [{ exerciseName: "Bench press" }] }).success, false);
  assert.equal(LogWorkoutSchema.safeParse({ requestId: requestId(), date, completed: true, userId: "foreign", exercises: [exercise] }).success, false);
  assert.equal(LogWorkoutSchema.safeParse({ requestId: requestId(), date: "2026-02-30", completed: true, exercises: [exercise] }).success, false);
  assert.equal(WorkoutHistorySchema.safeParse({ days: 367 }).success, false);
  assert.equal(WorkoutHistorySchema.safeParse({ limit: 1001 }).success, false);
  assert.equal(MeasurementsSchema.safeParse({ days: 0 }).success, false);
  assert.equal(SetWaterSchema.safeParse({ requestId: requestId(), date, glasses: Infinity, expectedGlasses: 0 }).success, false);
  assert.equal(UpdateWorkoutSchema.safeParse({ requestId: requestId(), entryId: "id", expectedUpdatedAt: new Date().toISOString(), changes: {} }).success, false);
  const { a } = await fixture();
  await assert.rejects(logMcpWorkout(a.id, { requestId: requestId(), date: "2099-01-01", completed: true, exercises: [exercise] }), /future date/);
  await assert.rejects(setMcpWeight(a.id, { requestId: requestId(), date: "2099-01-01", weightKg: 75, expectedWeightKg: null }), /future date/);
  assert.equal(await prisma.workoutEntry.count({ where: { userId: a.id } }), 0);
});
