#!/usr/bin/env node
// Generate reviewable SQL only. Never load application credentials or connect.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--help") {
  process.stdout.write(`Generate the guarded MCP tracking schema rollout; no database is contacted.

  node scripts/rollout-mcp-tracking.mjs > /private/path/mcp-rehearsal.sql
  node scripts/rollout-mcp-tracking.mjs --commit > /private/path/mcp-apply.sql

The default script ends with ROLLBACK. --commit generates a COMMIT script.
Both scripts verify the pre-tracking table set, preserve row counts and hashes of
all existing tables, and require the new mutation table to start empty.
Review the output, verify the intended direct database connection, and take
and verify a fresh private backup before running it through psql.
`);
  process.exit(0);
}
if (args.length > 1 || (args.length === 1 && args[0] !== "--commit")) {
  process.stderr.write("Expected no arguments, --commit, or --help. No database was contacted.\n");
  process.exit(1);
}

const commit = args[0] === "--commit";
const sourcePath = new URL("../prisma/rollouts/20261105_mcp_tracking.sql", import.meta.url);
const source = readFileSync(sourcePath, "utf8");
const match = /^\s*(?:--[^\n]*\n)*BEGIN;\s*([\s\S]*?)\s*COMMIT;\s*$/.exec(source);
assert(match, "Reviewed rollout must have exactly one BEGIN/COMMIT wrapper.");
const body = match[1];
assert(!/^\s*(?:BEGIN|COMMIT|ROLLBACK|DROP|TRUNCATE|DELETE|UPDATE|INSERT)\b/im.test(body), "Expected only additive reviewed schema statements inside the rollout.");
assert(!/^\s*\\/m.test(body), "Unexpected psql command in reviewed rollout.");
const sha256 = createHash("sha256").update(source).digest("hex");
const oldTables = [
  "User", "Profile", "Food", "LogEntry", "BuddyRelationship", "Reaction",
  "WaterEntry", "WeightEntry", "WorkoutEntry", "WorkoutReaction",
  "LogBatch", "SavedMeal", "MealProposal", "WeeklyCheckIn",
  "OAuthClient", "OAuthConnection", "OAuthAuthorizationCode", "OAuthAccessToken", "OAuthRefreshToken", "OAuthRateLimit",
].sort();
const newTables = ["McpMutation"];
const sqlArray = tables => `ARRAY[${tables.map(table => `'${table}'`).join(", ")}]::text[]`;

process.stdout.write(`-- NutriTracker MCP tracking guarded ${commit ? "APPLY" : "REHEARSAL (rolls back)"}.
-- Source: prisma/rollouts/20261105_mcp_tracking.sql
-- Source SHA-256: ${sha256}
-- Review this SQL and verify the target database and fresh backup first.
-- Execute through psql in one session. Do not add an outer transaction.
\\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL search_path = public, pg_catalog;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- Refuse missing daily-logging tables, duplicate application, or table drift.
DO $preflight$
DECLARE present_tables text[];
BEGIN
  SELECT array_agg(tablename::text ORDER BY tablename::text COLLATE "C")
    INTO present_tables FROM pg_catalog.pg_tables WHERE schemaname = 'public';
  IF present_tables IS DISTINCT FROM ${sqlArray(oldTables)} THEN
    RAISE EXCEPTION 'Expected the 20 pre-tracking tables; found %. Inspect schema before retrying.', present_tables;
  END IF;
END
$preflight$;

LOCK TABLE ${oldTables.map(table => `"${table}"`).join(", ")} IN SHARE MODE;

CREATE TEMP TABLE nt_mcp_before (
  table_name text PRIMARY KEY,
  row_count bigint NOT NULL,
  digest text NOT NULL
) ON COMMIT DROP;

-- Hash all columns server-side. Actual account and nutrition data stay in DB.
CREATE FUNCTION pg_temp.nt_mcp_snapshot(table_name text)
RETURNS TABLE (row_count bigint, digest text)
LANGUAGE plpgsql AS $snapshot$
BEGIN
  RETURN QUERY EXECUTE format($query$
    SELECT count(*)::bigint,
      md5(coalesce(string_agg(md5(to_jsonb(row_data)::text), '' ORDER BY to_jsonb(row_data)::text COLLATE "C"), ''))
    FROM public.%I AS row_data
  $query$, table_name);
END
$snapshot$;

INSERT INTO nt_mcp_before
SELECT name, snapshot.row_count, snapshot.digest
FROM unnest(${sqlArray(oldTables)}) AS tables(name)
CROSS JOIN LATERAL pg_temp.nt_mcp_snapshot(name) AS snapshot;

-- Exact reviewed DDL, with only its outer transaction replaced by this one.
${body}

DO $verify$
DECLARE
  original record;
  after_count bigint;
  after_digest text;
  new_table text;
BEGIN
  FOR original IN SELECT * FROM nt_mcp_before LOOP
    SELECT row_count, digest INTO after_count, after_digest
      FROM pg_temp.nt_mcp_snapshot(original.table_name);
    IF after_count IS DISTINCT FROM original.row_count OR after_digest IS DISTINCT FROM original.digest THEN
      RAISE EXCEPTION 'Existing data changed in table %. Rolling back.', original.table_name;
    END IF;
  END LOOP;
  FOREACH new_table IN ARRAY ${sqlArray(newTables)} LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', new_table) INTO after_count;
    IF after_count <> 0 THEN
      RAISE EXCEPTION 'New table % is not empty. Rolling back.', new_table;
    END IF;
  END LOOP;
END
$verify$;

-- An attestation for this repeatable-read snapshot, not a substitute for backup.
SELECT table_name, row_count, digest AS verified_digest
FROM nt_mcp_before ORDER BY table_name COLLATE "C";

${commit ? "COMMIT" : "ROLLBACK"};
`);
