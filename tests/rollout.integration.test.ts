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
const mcpRollout = path.join(root, "prisma/rollouts/20261104_claude_mcp.sql");
const baseline = path.join(root, "tests/fixtures/pre-daily-logging.prisma");
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;

test("reviewed daily logging and MCP SQL preserve old data, match Prisma, and roll back atomically", { timeout: 120_000 }, async () => {
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
  function schemaSnapshot() {
    return command(["migrate", "diff", "--from-empty", "--to-url", url.toString(), "--script"]);
  }
  function guardedRollout(commit = false) {
    const result = spawnSync(process.execPath, ["scripts/rollout-claude-mcp.mjs", ...(commit ? ["--commit"] : [])], { cwd: root, env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
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
    async function recordsFor(selectedTables: Map<string, string[]>) {
      const records: Record<string, Array<{ row: string }>> = {};
      for (const [table, names] of selectedTables) {
        records[table] = await db.$queryRawUnsafe(`SELECT to_jsonb(record)::text AS row FROM (SELECT ${names.map(quote).join(",")} FROM ${quote(table)}) record ORDER BY id`);
      }
      return records;
    }
    const oldRecords = () => recordsFor(tables);
    const before = await oldRecords();
    assert.equal(Object.values(before).reduce((sum, rows) => sum + rows.length, 0), 14);
    const applied = sql(readFileSync(rollout, "utf8"));
    assert.equal(applied.status, 0, applied.stderr);
    assert.deepEqual(await oldRecords(), before, "An existing record was changed by the additive rollout");
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
    const dailySchema = schemaSnapshot();
    const repeated = sql(readFileSync(rollout, "utf8"));
    assert.notEqual(repeated.status, 0, "A repeated rollout must fail instead of silently making changes");
    assert.match(repeated.stderr, /already exists/);
    assert.deepEqual(await oldRecords(), before);
    assert.equal(schemaSnapshot(), dailySchema);

    const dailySeed = sql(`
      INSERT INTO "LogBatch" (id,"userId","requestId",kind) VALUES ('existing-batch','old-a','existing-request','AI_ESTIMATE');
      INSERT INTO "SavedMeal" (id,"userId",name,items,"updatedAt") VALUES ('existing-saved-meal','old-a','Existing lunch','[]',now());
      INSERT INTO "MealProposal" (id,"senderId","recipientId","senderRequestId",name,date,"mealType",items) VALUES ('existing-proposal','old-a','old-b','existing-proposal-request','Existing lunch','2026-07-16','LUNCH','[]');
      INSERT INTO "WeeklyCheckIn" (id,"userId","weekStart") VALUES ('existing-check-in','old-a','2026-07-13');
      UPDATE "Profile" SET "cooperativeCheckInEnabled"=true WHERE id='old-profile-a';
      UPDATE "Food" SET "nutritionBasis"='PER_100G' WHERE id='old-roti';
      UPDATE "LogEntry" SET "batchId"='existing-batch' WHERE id='old-log-roti';
    `);
    assert.equal(dailySeed.status, 0, dailySeed.stderr);
    const dailyColumns = await db.$queryRaw<Array<{ table_name: string; column_name: string }>>`
      SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name, ordinal_position
    `;
    const dailyTables = new Map<string, string[]>();
    for (const column of dailyColumns) dailyTables.set(column.table_name, [...(dailyTables.get(column.table_name) || []), column.column_name]);
    assert.equal(dailyTables.size, 14);
    const beforeMcp = await recordsFor(dailyTables);

    const rehearsal = sql(guardedRollout());
    assert.equal(rehearsal.status, 0, rehearsal.stderr);
    assert.equal(schemaSnapshot(), dailySchema, "The guarded rehearsal must roll back all OAuth DDL");
    assert.deepEqual(await recordsFor(dailyTables), beforeMcp);

    const changedData = sql(guardedRollout(true).replace("DO $verify$", `UPDATE "Food" SET name='Unexpected mutation' WHERE id='old-roti';\nDO $verify$`));
    assert.notEqual(changedData.status, 0, "The guarded rollout must reject changes to existing data");
    assert.match(changedData.stderr, /Existing data changed in table Food/);
    assert.equal(schemaSnapshot(), dailySchema);
    assert.deepEqual(await recordsFor(dailyTables), beforeMcp, "A failed preservation check must undo the mutation and OAuth DDL");

    // Force a failure after all OAuth DDL has run but before commit. PostgreSQL
    // must remove every new table/index/constraint while retaining daily logging.
    const mcpSql = readFileSync(mcpRollout, "utf8");
    assert.match(mcpSql, /^BEGIN;/m);
    assert.match(mcpSql, /^COMMIT;\s*$/m);
    const failedMcp = sql(mcpSql.replace(/^COMMIT;\s*$/m, "SELECT 1 / 0;\nCOMMIT;"));
    assert.notEqual(failedMcp.status, 0, "The injected failure must abort the MCP rollout");
    assert.match(failedMcp.stderr, /division by zero/);
    assert.equal(schemaSnapshot(), dailySchema, "A failed MCP rollout left schema changes behind");
    assert.deepEqual(await oldRecords(), before);
    assert.deepEqual(await recordsFor(dailyTables), beforeMcp);

    const appliedMcp = sql(guardedRollout(true));
    assert.equal(appliedMcp.status, 0, appliedMcp.stderr);
    assert.deepEqual(await oldRecords(), before, "The MCP rollout changed existing account or nutrition data");
    assert.deepEqual(await recordsFor(dailyTables), beforeMcp, "The MCP rollout changed daily logging data");
    command(["migrate", "diff", "--from-url", url.toString(), "--to-schema-datamodel", "prisma/schema.prisma", "--exit-code"]);
    for (const table of ["OAuthClient", "OAuthConnection", "OAuthAuthorizationCode", "OAuthAccessToken", "OAuthRefreshToken", "OAuthRateLimit"]) {
      const [{ count }] = await db.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT count(*) AS count FROM ${quote(table)}`);
      assert.equal(count, 0n, `${table} must start empty`);
    }
    const mcpSchema = schemaSnapshot();
    const repeatedGuarded = sql(guardedRollout(true));
    assert.notEqual(repeatedGuarded.status, 0);
    assert.match(repeatedGuarded.stderr, /Expected the 14 pre-MCP tables/);
    assert.equal(schemaSnapshot(), mcpSchema);
    const repeatedMcp = sql(mcpSql);
    assert.notEqual(repeatedMcp.status, 0, "A repeated MCP rollout must fail instead of silently hiding drift");
    assert.match(repeatedMcp.stderr, /already exists/);
    assert.equal(schemaSnapshot(), mcpSchema);
    assert.deepEqual(await oldRecords(), before);
    assert.deepEqual(await recordsFor(dailyTables), beforeMcp);
  } finally {
    await db.$disconnect();
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${quote(database)}`);
    await admin.$disconnect();
  }
});
