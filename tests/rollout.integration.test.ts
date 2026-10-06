import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";

const fixtureUrl = new URL(process.env.DATABASE_URL || "file:///missing-fixture-database");
assert.equal(fixtureUrl.hostname, "localhost");
assert.equal(fixtureUrl.username, "nt_fixture");
assert.equal(fixtureUrl.pathname, "/nutritracker_test");
assert.match(fixtureUrl.searchParams.get("host") || "", /^\/.*\/nt-fixture-[a-f0-9]{12}\/socket$/);
const root = process.cwd();
const rollout = path.join(root, "prisma/rollouts/20261006_daily_logging.sql");
const baseline = path.join(root, "tests/fixtures/pre-daily-logging.prisma");
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;

test("reviewed additive SQL preserves every old field and matches the new Prisma schema; reapplication fails atomically", { timeout: 120_000 }, async () => {
  const admin = new PrismaClient({ datasourceUrl: fixtureUrl.toString(), log: [] });
  const database = `nt_rollout_test_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  assert.match(database, /^nt_rollout_test_[a-f0-9]{12}$/);
  const url = new URL(fixtureUrl);
  url.pathname = `/${database}`;
  const db = new PrismaClient({ datasourceUrl: url.toString(), log: [] });
  const env = { ...process.env, DATABASE_URL: url.toString(), PRISMA_HIDE_UPDATE_MESSAGE: "1" };
  const psql = process.env.TEST_POSTGRES_BIN ? path.join(process.env.TEST_POSTGRES_BIN, "psql") : "psql";
  function sql(input: string) {
    return spawnSync(psql, ["--dbname", url.toString(), "--set", "ON_ERROR_STOP=1", "--no-psqlrc"], { cwd: root, env, input, encoding: "utf8" });
  }
  function command(args: string[]) {
    const result = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", ...args], { cwd: root, env, encoding: "utf8" });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    return result.stdout;
  }
  try {
    const [settings] = await admin.$queryRaw<Array<{ listen: string }>>`SELECT current_setting('listen_addresses') AS listen`;
    assert.equal(settings.listen, "");
    await admin.$executeRawUnsafe(`CREATE DATABASE ${quote(database)}`);
    // This checked-in fixture is the unmodified schema from production commit 0884ab0.
    command(["db", "push", "--schema", baseline, "--skip-generate"]);
    const seed = sql(`
      INSERT INTO "User" (id, username, "passwordHash", "updatedAt") VALUES ('old-a','old-a','fixture',now()),('old-b','old-b','fixture',now());
      INSERT INTO "Profile" (id,"userId","updatedAt",allergies) VALUES ('old-profile-a','old-a',now(),ARRAY['fixture-allergy']),('old-profile-b','old-b',now(),ARRAY[]::TEXT[]);
      INSERT INTO "Food" (id,name,source,"kcalPer100g","proteinPer100g","carbsPer100g","fatPer100g","fiberPer100g","updatedAt") VALUES
        ('old-roti','Legacy roti','LLM',7800,240,1560,70,100,now()),('old-water','Water','MANUAL',0,0,0,0,0,now());
      INSERT INTO "LogEntry" (id,"userId",date,"mealType",amount,unit,"foodId","isEstimated","sourceText","estimationMeta","snapshotKcal","snapshotProteinG","snapshotCarbsG","snapshotFatG","snapshotFiberG","updatedAt") VALUES
        ('old-log-roti','old-a','2026-07-16','LUNCH',2,'GRAM','old-roti',true,'two rotis','{"originalUnit":"roti","originalQuantity":2}',156,4.8,31.2,1.4,2,now()),
        ('old-log-water','old-a','2026-07-16','LUNCH',250,'GRAM','old-water',false,NULL,NULL,0,0,0,0,0,now());
      INSERT INTO "BuddyRelationship" (id,"requesterId","addresseeId",status,"updatedAt") VALUES ('old-buddy','old-a','old-b','ACCEPTED',now());
      INSERT INTO "Reaction" (id,"logEntryId","userId",type) VALUES ('old-reaction','old-log-roti','old-b','FIRE');
      INSERT INTO "WaterEntry" (id,"userId",date,glasses,"updatedAt") VALUES ('old-water-log','old-a','2026-07-16',5,now());
      INSERT INTO "WeightEntry" (id,"userId",date,"weightKg") VALUES ('old-weight','old-a','2026-07-16',71.2);
      INSERT INTO "WorkoutEntry" (id,"userId",date,"exerciseName","durationMinutes","caloriesBurned","updatedAt") VALUES ('old-workout','old-b','2026-07-16','Fixture walk',30,125,now());
      INSERT INTO "WorkoutReaction" (id,"workoutEntryId","userId",type) VALUES ('old-workout-reaction','old-workout','old-a','MUSCLE');
    `);
    assert.equal(seed.status, 0, seed.stderr);
    const columns = await db.$queryRaw<Array<{ table_name: string; column_name: string }>>`
      SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name, ordinal_position
    `;
    const tables = new Map<string, string[]>();
    for (const column of columns) tables.set(column.table_name, [...(tables.get(column.table_name) || []), column.column_name]);
    assert.equal(tables.size, 10);
    async function oldRecords() {
      const records: Record<string, Array<{ row: string }>> = {};
      for (const [table, names] of tables) {
        records[table] = await db.$queryRawUnsafe(`SELECT to_jsonb(record)::text AS row FROM (SELECT ${names.map(quote).join(",")} FROM ${quote(table)}) record ORDER BY id`);
      }
      return records;
    }
    const before = await oldRecords();
    assert.equal(Object.values(before).reduce((sum, rows) => sum + rows.length, 0), 14);
    const applied = sql(readFileSync(rollout, "utf8"));
    assert.equal(applied.status, 0, applied.stderr);
    assert.deepEqual(await oldRecords(), before, "An existing record was changed by the additive rollout");
    command(["migrate", "diff", "--from-url", url.toString(), "--to-schema-datamodel", "prisma/schema.prisma", "--exit-code"]);
    for (const table of ["LogBatch", "SavedMeal", "MealProposal", "WeeklyCheckIn"]) {
      const [{ count }] = await db.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT count(*) AS count FROM ${quote(table)}`);
      assert.equal(count, 0n);
    }
    const [{ legacyBasis, optedIn, batched }] = await db.$queryRaw<Array<{ legacyBasis: number; optedIn: number; batched: number }>>`
      SELECT (SELECT count(*)::int FROM "Food" WHERE "nutritionBasis" IS NOT NULL) AS "legacyBasis",
      (SELECT count(*)::int FROM "Profile" WHERE "cooperativeCheckInEnabled") AS "optedIn",
      (SELECT count(*)::int FROM "LogEntry" WHERE "batchId" IS NOT NULL) AS "batched"
    `;
    assert.equal(legacyBasis, 0);
    assert.equal(optedIn, 0);
    assert.equal(batched, 0);
    const repeated = sql(readFileSync(rollout, "utf8"));
    assert.notEqual(repeated.status, 0, "A repeated rollout must fail instead of silently making changes");
    assert.match(repeated.stderr, /already exists/);
    assert.deepEqual(await oldRecords(), before);
  } finally {
    await db.$disconnect();
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${quote(database)}`);
    await admin.$disconnect();
  }
});
