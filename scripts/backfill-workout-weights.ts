/**
 * scripts/backfill-workout-weights.ts
 *
 * Historical WorkoutEntry rows have weightKg = null because the AI logging path
 * never captured the load (fixed in 81aa574). The load is still there in the
 * saved sourceText ("Lat pulldown 39kg, 10 reps, 3 sets"), so this re-runs the
 * now-fixed estimator over each distinct sourceText and fills in the weight for
 * the exercises it can match by name.
 *
 * DRY RUN BY DEFAULT — prints what it would change and writes nothing.
 * Pass --apply to actually update rows.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/backfill-workout-weights.ts
 *   npx tsx --env-file=.env scripts/backfill-workout-weights.ts --apply
 *
 * Options:
 *   --apply          write the changes (default is dry run)
 *   --user <name>    limit to one username
 *   --limit <n>      only process the first n workout logs (n LLM calls)
 *   --all            also process logs whose text mentions no load at all
 *
 * Requires the same LLM_* env vars the app uses. Only ever fills rows where
 * weightKg IS NULL — an existing weight is never overwritten.
 */

import { PrismaClient } from "@prisma/client";
import { estimateWorkoutFromText } from "../lib/workout-llm";

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const INCLUDE_NO_LOAD = args.includes("--all");
const USER = argValue("--user");
const LIMIT = Number(argValue("--limit") ?? "0") || Infinity;

function argValue(flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

// Source text that plausibly states a load. Without one there is nothing to
// recover, so we skip the LLM call entirely rather than pay for a null answer.
const LOAD_RE = /\d+\s*(?:kgs?|kilos?|kilograms?|lbs?|pounds?)\b/i;

const MAX_PLAUSIBLE_KG = 500;

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

type Entry = {
  id: string;
  userId: string;
  date: string;
  exerciseName: string;
  sets: number | null;
  reps: number | null;
  sourceText: string;
};

/**
 * Match each DB entry to an estimated exercise carrying a weight. Exact
 * normalized name first, then unambiguous substring containment; a candidate is
 * consumed once matched so two rows of the same exercise don't share one answer.
 */
function matchWeights(
  entries: Entry[],
  candidates: { name: string; weightKg: number }[]
): Map<string, number> {
  const pool = candidates.map((c) => ({ ...c, key: normalize(c.name), used: false }));
  const matched = new Map<string, number>();

  for (const pass of ["exact", "contains"] as const) {
    for (const entry of entries) {
      if (matched.has(entry.id)) continue;
      const key = normalize(entry.exerciseName);
      const hits = pool.filter((c) => {
        if (c.used) return false;
        return pass === "exact"
          ? c.key === key
          : c.key.includes(key) || key.includes(c.key);
      });
      if (hits.length !== 1) continue; // ambiguous → leave for a human
      hits[0].used = true;
      matched.set(entry.id, hits[0].weightKg);
    }
  }

  return matched;
}

async function main() {
  const users = await prisma.user.findMany({ select: { id: true, username: true } });
  const usernameById = new Map(users.map((u) => [u.id, u.username]));

  const profiles = await prisma.profile.findMany({ select: { userId: true, weightKg: true } });
  const bodyWeightById = new Map(profiles.map((p) => [p.userId, p.weightKg ?? undefined]));

  const rows = await prisma.workoutEntry.findMany({
    where: {
      weightKg: null,
      sourceText: { not: null },
      ...(USER ? { user: { username: USER } } : {}),
    },
    select: {
      id: true,
      userId: true,
      date: true,
      exerciseName: true,
      sets: true,
      reps: true,
      sourceText: true,
    },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });

  // One applyEstimatedWorkout() call created every row sharing user+date+text,
  // so that triple is the unit we re-estimate.
  const groups = new Map<string, Entry[]>();
  for (const r of rows) {
    if (!r.sourceText) continue;
    const key = `${r.userId}|${r.date}|${r.sourceText}`;
    const list = groups.get(key) ?? [];
    list.push(r as Entry);
    groups.set(key, list);
  }

  const all = [...groups.values()];
  const eligible = INCLUDE_NO_LOAD ? all : all.filter((g) => LOAD_RE.test(g[0].sourceText));
  const targets = eligible.slice(0, LIMIT === Infinity ? undefined : LIMIT);

  const skippedNoLoad = all.length - eligible.length;
  console.log(
    `${rows.length} rows without weight across ${all.length} logs · ` +
      `${targets.length} to process` +
      (skippedNoLoad ? ` · ${skippedNoLoad} skipped (no load mentioned)` : "") +
      (targets.length < eligible.length ? ` · ${eligible.length - targets.length} beyond --limit` : "")
  );
  console.log(APPLY ? "MODE: apply (will write)\n" : "MODE: dry run (no writes)\n");

  const proposals: {
    username: string;
    date: string;
    exerciseName: string;
    sets: number | null;
    reps: number | null;
    weightKg: number;
    volumeKg: number;
  }[] = [];
  let unmatched = 0;
  let failed = 0;

  for (const [i, entries] of targets.entries()) {
    const { userId, sourceText, date } = entries[0];
    const username = usernameById.get(userId) ?? userId;
    process.stdout.write(`[${i + 1}/${targets.length}] ${username} ${date} … `);

    let estimate;
    try {
      estimate = await estimateWorkoutFromText({
        text: sourceText,
        weightKg: bodyWeightById.get(userId),
      });
    } catch (err) {
      failed++;
      console.log(`FAILED (${err instanceof Error ? err.message : String(err)})`);
      continue;
    }

    const candidates = estimate.exercises
      .filter((ex) => ex.weightKg && ex.weightKg > 0 && ex.weightKg <= MAX_PLAUSIBLE_KG)
      .map((ex) => ({ name: ex.exerciseName, weightKg: ex.weightKg as number }));

    const matched = matchWeights(entries, candidates);
    unmatched += entries.length - matched.size;

    for (const entry of entries) {
      const weightKg = matched.get(entry.id);
      if (weightKg === undefined) continue;
      proposals.push({
        username,
        date,
        exerciseName: entry.exerciseName,
        sets: entry.sets,
        reps: entry.reps,
        weightKg,
        volumeKg: Math.round(weightKg * (entry.sets ?? 0) * (entry.reps ?? 0)),
      });
      if (APPLY) {
        await prisma.workoutEntry.update({ where: { id: entry.id }, data: { weightKg } });
      }
    }

    console.log(`${matched.size}/${entries.length} matched`);
  }

  console.log("");
  console.table(
    proposals.map((p) => ({
      user: p.username,
      date: p.date,
      exercise: p.exerciseName.slice(0, 32),
      scheme: `${p.sets ?? "—"}×${p.reps ?? "—"}`,
      kg: p.weightKg,
      volume: p.volumeKg,
    }))
  );

  const totalVolume = proposals.reduce((s, p) => s + p.volumeKg, 0);
  console.log(
    `\n${proposals.length} rows ${APPLY ? "updated" : "would be updated"} · ` +
      `${totalVolume.toLocaleString()} kg of volume recovered · ` +
      `${unmatched} left unmatched` +
      (failed ? ` · ${failed} logs failed to estimate` : "")
  );
  if (!APPLY && proposals.length) {
    console.log("Re-run with --apply to write these.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
