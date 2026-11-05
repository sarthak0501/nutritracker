#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import bcrypt from "bcryptjs";
import { fixtureClient, verifyFixture } from "./seed-ui-fixture.mjs";

const fixture = JSON.parse(readFileSync(new URL("../tests/fixtures/claude-mcp-evaluation.json", import.meta.url), "utf8"));
assert.equal(fixture.fixtureOnly, true);
assert.equal(fixture.version, 1);
assert.deepEqual([fixture.username, fixture.otherUsername], ["mcp-eval-jordan", "mcp-eval-riley"]);
const client = fixtureClient();
try {
  await verifyFixture(client);
  const old = await client.user.findMany({ where: { username: { in: [fixture.username, fixture.otherUsername] } }, select: { id: true } });
  await client.user.deleteMany({ where: { id: { in: old.map(user => user.id) } } });
  await client.food.deleteMany({ where: { createdByUserId: { in: old.map(user => user.id) } } });
  const password = "FixtureOnly-Evaluation-2026!";
  const passwordHash = await bcrypt.hash(password, 4);
  const users = [];
  for (const username of [fixture.username, fixture.otherUsername]) {
    users.push(await client.user.create({ data: { username, passwordHash, profile: { create: { ...fixture.targets, onboardingCompleted: true } } } }));
  }
  for (const row of fixture.entries) {
    // Deliberately different catalog values prove that historical snapshots,
    // including zeros, remain authoritative. Missing serving weight stays unknown.
    const food = await client.food.create({ data: { name: row.name, createdByUserId: users[0].id, nutritionBasis: "GRAMS",
      kcalPer100g: 999, proteinPer100g: 99, carbsPer100g: 99, fatPer100g: 99, fiberPer100g: 99 } });
    const n = row.snapshot;
    await client.logEntry.create({ data: { userId: users[0].id, foodId: food.id, date: row.date, mealType: row.mealType, mealName: row.mealName,
      amount: n ? 100 : 1, unit: n ? "GRAM" : "SERVING", isEstimated: false,
      ...(n ? { snapshotKcal: n[0], snapshotProteinG: n[1], snapshotCarbsG: n[2], snapshotFatG: n[3], snapshotFiberG: n[4] } : {}) } });
  }
  for (const row of fixture.dailyExtras) {
    await client.waterEntry.create({ data: { userId: users[0].id, date: row.date, glasses: row.waterGlasses } });
    if (row.workoutKcal) await client.workoutEntry.create({ data: { userId: users[0].id, date: row.date, exerciseName: "Synthetic walk", caloriesBurned: row.workoutKcal, isEstimated: true } });
  }
  const other = fixture.otherAccountEntry;
  const food = await client.food.create({ data: { name: "Other account private meal", createdByUserId: users[1].id,
    kcalPer100g: other.kcal, proteinPer100g: 0, carbsPer100g: 0, fatPer100g: 0 } });
  await client.logEntry.create({ data: { userId: users[1].id, foodId: food.id, date: other.date, mealType: "DINNER", amount: 100, unit: "GRAM",
    snapshotKcal: other.kcal, snapshotProteinG: 0, snapshotCarbsG: 0, snapshotFatG: 0, snapshotFiberG: 0 } });
  mkdirSync(".test-state", { recursive: true, mode: 0o700 });
  writeFileSync(".test-state/claude-mcp-evaluation-fixture.json", JSON.stringify({ fixtureOnly: true, username: fixture.username, userId: users[0].id, password }, null, 2), { mode: 0o600 });
  console.log("Seeded only mcp-eval-jordan and mcp-eval-riley in the protected local fixture database. No model evaluation was run.");
} finally { await client.$disconnect(); }
