#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

export function fixtureClient() {
  const url = new URL(process.env.DATABASE_URL || "file:///missing-fixture");
  assert.equal(url.protocol, "postgresql:");
  assert.equal(url.hostname, "localhost", "UI smoke tests only allow the local fixture database");
  assert.equal(url.username, "nt_fixture");
  assert.equal(url.pathname, "/nutritracker_test");
  assert.match(url.searchParams.get("host") || "", /^\/tmp\/nt-fixture-[a-f0-9]{12}\/socket$/);
  return new PrismaClient({ datasourceUrl: url.toString() });
}

export async function verifyFixture(client) {
  const [settings] = await client.$queryRaw`SELECT current_database() AS database, current_setting('listen_addresses') AS listen`;
  assert.equal(settings.database, "nutritracker_test");
  assert.equal(settings.listen, "", "The fixture must not listen on TCP");
}

export async function seedUiFixture() {
  const client = fixtureClient();
  try {
    await verifyFixture(client);
    const usernames = ["qa_alex", "qa_jamie"];
    const old = await client.user.findMany({ where: { username: { in: usernames } }, select: { id: true } });
    await client.user.deleteMany({ where: { id: { in: old.map((user) => user.id) } } });
    await client.food.deleteMany({ where: { createdByUserId: { in: old.map((user) => user.id) } } });
    const password = "FixtureOnly-2026!";
    const passwordHash = await bcrypt.hash(password, 4);
    const [alex, jamie] = await Promise.all(usernames.map((username) => client.user.create({ data: {
      username, passwordHash, profile: { create: { onboardingCompleted: true, kcalTarget: 2000, equipment: [], cooperativeCheckInEnabled: false } },
    } })));
    await client.buddyRelationship.create({ data: { requesterId: alex.id, addresseeId: jamie.id, status: "ACCEPTED" } });
    const date = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
    const [roti, water] = await Promise.all([
      client.food.create({ data: { name: "QA Roti", source: "LLM", createdByUserId: alex.id, kcalPer100g: 7800, proteinPer100g: 250, carbsPer100g: 1500, fatPer100g: 100, nutritionBasis: null } }),
      client.food.create({ data: { name: "QA Water", source: "MANUAL", createdByUserId: alex.id, kcalPer100g: 0, proteinPer100g: 0, carbsPer100g: 0, fatPer100g: 0, nutritionBasis: "GRAMS" } }),
    ]);
    const entries = await Promise.all([
      client.logEntry.create({ data: {
        userId: alex.id, foodId: roti.id, date, mealType: "LUNCH", mealName: "QA Usual lunch", amount: 2, unit: "GRAM", isEstimated: true,
        sourceText: "two rotis; synthetic fixture only", estimationMeta: { originalUnit: "roti", originalQuantity: 2 },
        snapshotKcal: 156, snapshotProteinG: 5, snapshotCarbsG: 30, snapshotFatG: 2, snapshotFiberG: 0,
      } }),
      client.logEntry.create({ data: {
        userId: alex.id, foodId: water.id, date, mealType: "LUNCH", mealName: "QA Usual lunch", amount: 250, unit: "GRAM",
        snapshotKcal: 0, snapshotProteinG: 0, snapshotCarbsG: 0, snapshotFatG: 0, snapshotFiberG: 0,
      } }),
    ]);
    const fixture = { fixtureOnly: true, date, password, alex: { id: alex.id, username: alex.username }, jamie: { id: jamie.id, username: jamie.username }, rotiId: roti.id, waterId: water.id, entryIds: entries.map((entry) => entry.id) };
    mkdirSync(".test-state", { recursive: true, mode: 0o700 });
    writeFileSync(".test-state/ui-fixture.json", JSON.stringify(fixture, null, 2), { mode: 0o600 });
    console.log("Seeded only qa_alex and qa_jamie in the protected local fixture database.");
    return fixture;
  } finally { await client.$disconnect(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await seedUiFixture();
