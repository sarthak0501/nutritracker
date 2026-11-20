#!/usr/bin/env node
// Emit reviewed SQL. Connection selection and execution belong to the operator.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--help") {
  console.log("Generate the buddy meal rollout SQL. Default: rehearse and roll back. --commit: verify all old data and commit. No database is contacted.");
  process.exit(0);
}
assert(args.length === 0 || (args.length === 1 && args[0] === "--commit"), "Expected no arguments or --commit.");
const commit = args[0] === "--commit";
const source = readFileSync(new URL("../prisma/rollouts/20261119_buddy_meal_logging.sql", import.meta.url), "utf8");
const body = /^BEGIN;\s*([\s\S]*?)\s*COMMIT;\s*$/.exec(source)?.[1];
assert(body && !/^\s*(?:\\|(?:BEGIN|COMMIT|ROLLBACK|DROP|TRUNCATE|DELETE|UPDATE|INSERT)\b)/im.test(body), "Expected one reviewed additive migration.");
const tables = [
  "User", "Profile", "Food", "LogEntry", "BuddyRelationship", "Reaction", "WaterEntry", "WeightEntry", "WorkoutEntry", "WorkoutReaction",
  "LogBatch", "SavedMeal", "MealProposal", "WeeklyCheckIn", "OAuthClient", "OAuthConnection", "OAuthAuthorizationCode", "OAuthAccessToken",
  "OAuthRefreshToken", "OAuthRateLimit", "McpMutation",
].sort();
const expectedTables = `ARRAY[${tables.map(t => `'${t}'`).join(", ")}]::text[]`;

process.stdout.write(`-- NutriTracker buddy meals guarded ${commit ? "APPLY" : "REHEARSAL (rolls back)"}.
-- Source: prisma/rollouts/20261119_buddy_meal_logging.sql
-- Source SHA-256: ${createHash("sha256").update(source).digest("hex")}
\\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL REPEATABLE READ;
SET LOCAL search_path = public, pg_catalog;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

LOCK TABLE ${tables.map(t => `"${t}"`).join(", ")} IN SHARE MODE;
DO $preflight$
BEGIN
  IF (SELECT array_agg(tablename::text ORDER BY tablename::text COLLATE "C") FROM pg_catalog.pg_tables
      WHERE schemaname = 'public') IS DISTINCT FROM ${expectedTables} THEN
    RAISE EXCEPTION 'Expected the 21 pre-buddy-meals tables. Inspect schema before retrying.';
  END IF;
END
$preflight$;

-- Keep the column projection from before the rollout. All digests stay inside
-- PostgreSQL, and the same projection is used after adding new columns.
CREATE FUNCTION pg_temp.nt_snapshot(table_name text, column_projection text)
RETURNS TABLE (row_count bigint, digest text)
LANGUAGE plpgsql AS $snapshot$
BEGIN
  RETURN QUERY EXECUTE format($query$
    SELECT count(*), md5(coalesce(string_agg(row_hash, '' ORDER BY row_hash COLLATE "C"), ''))
    FROM (SELECT md5(to_jsonb(old_row)::text) AS row_hash FROM (SELECT %s FROM public.%I) old_row) hashes
  $query$, column_projection, table_name);
END
$snapshot$;

CREATE TEMP TABLE nt_before ON COMMIT DROP AS
SELECT table_name, column_projection, snapshot.* FROM (
  SELECT table_name::text, string_agg(format('%I', column_name), ', ' ORDER BY ordinal_position) AS column_projection
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name::text = ANY(${expectedTables})
  GROUP BY table_name
) projections CROSS JOIN LATERAL pg_temp.nt_snapshot(table_name, column_projection) snapshot;

${body}

DO $verify$
DECLARE original record;
BEGIN
  FOR original IN SELECT * FROM nt_before LOOP
    IF NOT EXISTS (SELECT FROM pg_temp.nt_snapshot(original.table_name, original.column_projection) s
                   WHERE (s.row_count, s.digest) = (original.row_count, original.digest)) THEN
      RAISE EXCEPTION 'Existing data changed in table %. Rolling back.', original.table_name;
    END IF;
  END LOOP;
  IF EXISTS (SELECT FROM "BuddyRelationship" WHERE "requesterAllowsMealLogging" OR "addresseeAllowsMealLogging")
     OR EXISTS (SELECT FROM "LogBatch" WHERE "loggedByUsername" IS NOT NULL)
     OR EXISTS (SELECT FROM "MealProposal" WHERE "occurrenceKey" IS NOT NULL) THEN
    RAISE EXCEPTION 'Unexpected defaults on existing records. Rolling back.';
  END IF;
END
$verify$;

SELECT table_name, row_count, digest AS verified_digest FROM nt_before ORDER BY table_name COLLATE "C";
${commit ? "COMMIT" : "ROLLBACK"};
`);
