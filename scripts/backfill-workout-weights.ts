/**
 * scripts/backfill-workout-weights.ts
 *
 * Historical WorkoutEntry rows have weightKg = null because the AI logging path
 * never captured the load (fixed in 81aa574). The load is still sitting in the
 * saved sourceText, in two shapes:
 *
 *   one-liner:  "Leg press 36 kg weight- 10 reps , 3 sets"
 *   set block:  "Lat Pulldown\n10 reps x 25 kg\n8 reps x 39 kg\n..."
 *
 * Both are regular enough to parse directly, so this does no LLM calls: it
 * splits the text into per-exercise segments, reads the set lines, and writes
 * a rep-weighted mean load. Deterministic, free, and re-runnable.
 *
 * DRY RUN BY DEFAULT — prints what it would change and writes nothing.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/backfill-workout-weights.ts
 *   npx tsx --env-file=.env scripts/backfill-workout-weights.ts --apply
 *
 * Options:
 *   --apply        write the changes (default is dry run)
 *   --fix-reps     also correct sets/reps where the stored values disagree
 *                  with the text (see the reps note below)
 *   --user <name>  limit to one username
 *   --verbose      show the parsed set records per entry
 *
 * Only ever fills rows where weightKg IS NULL — an existing weight is never
 * overwritten.
 *
 * Why a rep-weighted mean rather than the top set: trends multiplies
 * weightKg × sets × reps, so the single stored number should be the one that
 * reproduces true total volume. For 10x25kg, 8x39kg, 8x45kg that is 35.9 kg,
 * not the 45 kg top set (which would overstate volume by 25%).
 *
 * Reps note: some rows stored the SUM of reps across sets rather than reps per
 * set (a Lat Pulldown of 10+8+10+10 was saved as 4 sets x 38 reps), which
 * inflates volume ~4x on its own. --fix-reps rewrites those from the text.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const FIX_REPS = args.includes("--fix-reps");
const VERBOSE = args.includes("--verbose");
const USER = args.includes("--user") ? args[args.indexOf("--user") + 1] : undefined;

const LB_TO_KG = 0.453592;
const MAX_PLAUSIBLE_KG = 500;
const MATCH_THRESHOLD = 0.5;

// "45 kg", "10lb", "20 pounds" — captures the number and the unit
const WEIGHT_RE = /(\d+(?:\.\d+)?)\s*(kgs?|kilos?|kilograms?|lbs?|pounds?)\b/gi;
// digits immediately before the word: "10 reps", "10reps", "1set."
const REPS_RE = /(\d+)\s*reps?\b/i;
const SETS_RE = /(\d+)\s*sets?\b/i;

function toKg(value: number, unit: string): number {
  return /^(lbs?|pounds?)$/i.test(unit) ? value * LB_TO_KG : value;
}

function tokens(text: string): string[] {
  // Parenthetical qualifiers are the estimator's embellishment, not the user's
  // words ("Chest Press (Barbell or Machine)"), so they'd only dilute the score.
  return text.replace(/\([^)]*\)/g, " ").toLowerCase().match(/[a-z]+/g) ?? [];
}

// Tolerates the typos in the raw logs: "deadift"/"deadlift", "dumbell"/"dumbbell"
function hasToken(lineTokens: string[], token: string): boolean {
  return lineTokens.some(
    (t) => t === token || (t.length >= 4 && token.length >= 4 && t.slice(0, 4) === token.slice(0, 4))
  );
}

function nameScore(exerciseName: string, line: string): number {
  const wanted = tokens(exerciseName);
  if (wanted.length === 0) return 0;
  const have = tokens(line);
  return wanted.filter((t) => hasToken(have, t)).length / wanted.length;
}

// A bare line with no digits is an exercise heading, which is what separates
// one exercise's set lines from the next.
function isHeading(line: string): boolean {
  return line.length > 0 && !/\d/.test(line);
}

type SetRecord = { weightKg: number; reps: number | null; sets: number };

function parseSetLine(line: string): SetRecord[] {
  const weights = [...line.matchAll(WEIGHT_RE)].map((m) => toKg(Number(m[1]), m[2]));
  if (weights.length === 0) return [];

  const reps = REPS_RE.exec(line);
  const sets = SETS_RE.exec(line);

  // Several weights on one line means several sets written inline
  // ("6.8 kg x 1:00 6.8 kg x 1:00 ..."), so each becomes its own record.
  return weights
    .filter((w) => w > 0 && w <= MAX_PLAUSIBLE_KG)
    .map((weightKg) => ({
      weightKg,
      reps: reps ? Number(reps[1]) : null,
      sets: weights.length === 1 && sets ? Number(sets[1]) : 1,
    }));
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
 * Slice the log text into one line-range per entry. Each entry anchors on the
 * line naming it; its segment runs to the next anchor or the next heading.
 */
function segmentsFor(entries: Entry[], text: string): Map<string, string[]> {
  const lines = text.split("\n").map((l) => l.trim());
  const anchors = new Map<string, number>();

  let cursor = 0;
  for (const entry of entries) {
    let best = -1;
    let bestScore = 0;
    for (let i = cursor; i < lines.length; i++) {
      const score = nameScore(entry.exerciseName, lines[i]);
      // >= threshold, > best: a name wrapped across two lines ("Standing
      // Dumbbell" / "Tricep Extension") scores exactly 0.5 on each, and we want
      // the first of them so the segment starts at the top of the block.
      if (score >= MATCH_THRESHOLD && score > bestScore) {
        bestScore = score;
        best = i;
        if (score === 1) break; // can't do better
      }
    }
    if (best < 0) continue;
    anchors.set(entry.id, best);
    cursor = best + 1;
  }

  const anchorLines = new Set(anchors.values());
  const segments = new Map<string, string[]>();

  for (const [id, start] of anchors) {
    const segment: string[] = [lines[start]];
    let seenData = false;
    for (let i = start + 1; i < lines.length; i++) {
      if (anchorLines.has(i)) break;
      if (isHeading(lines[i])) {
        // An exercise name wrapped onto a second line ("Standing Dumbbell" /
        // "Tricep Extension") is still the heading — only a heading that
        // follows actual set lines starts the next exercise.
        if (seenData) break;
        continue;
      }
      if (lines[i]) seenData = true;
      segment.push(lines[i]);
    }
    segments.set(id, segment);
  }

  return segments;
}

type Parsed = {
  weightKg: number;
  sets: number;
  repsPerSet: number | null;
  totalReps: number;
  records: SetRecord[];
};

function parseSegment(segment: string[]): Parsed | null {
  const records = segment.flatMap(parseSetLine);
  if (records.length === 0) return null;

  const setCount = records.reduce((n, r) => n + r.sets, 0);
  const totalReps = records.reduce((n, r) => n + r.sets * (r.reps ?? 0), 0);

  // Weight each set's load by the reps performed at it, so weightKg × sets ×
  // reps reproduces the real total volume. With no rep counts anywhere (timed
  // holds), fall back to a plain mean.
  const weightKg =
    totalReps > 0
      ? records.reduce((sum, r) => sum + r.sets * (r.reps ?? 0) * r.weightKg, 0) / totalReps
      : records.reduce((sum, r) => sum + r.sets * r.weightKg, 0) / setCount;

  return {
    weightKg: Math.round(weightKg * 10) / 10,
    sets: setCount,
    repsPerSet: totalReps > 0 ? Math.round(totalReps / setCount) : null,
    totalReps,
    records,
  };
}

async function main() {
  const users = await prisma.user.findMany({ select: { id: true, username: true } });
  const usernameById = new Map(users.map((u) => [u.id, u.username]));

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
  // so that triple is the log we re-read.
  const groups = new Map<string, Entry[]>();
  for (const r of rows) {
    if (!r.sourceText) continue;
    const key = `${r.userId}|${r.date}|${r.sourceText}`;
    const list = groups.get(key) ?? [];
    list.push(r as Entry);
    groups.set(key, list);
  }

  console.log(
    `${rows.length} rows without weight across ${groups.size} logs · ` +
      (APPLY ? "MODE: apply (will write)" : "MODE: dry run (no writes)") +
      (FIX_REPS ? " · sets/reps correction ON" : "")
  );

  const proposals: {
    user: string;
    date: string;
    exercise: string;
    stored: string;
    parsed: string;
    kg: number;
    volume: number;
    repsFix: boolean;
  }[] = [];
  let noWeight = 0;
  const unanchored: string[] = [];

  for (const entries of groups.values()) {
    const segments = segmentsFor(entries, entries[0].sourceText);

    for (const entry of entries) {
      const segment = segments.get(entry.id);
      if (!segment) {
        unanchored.push(`${entry.date} ${entry.exerciseName}`);
        continue;
      }
      const parsed = parseSegment(segment);
      if (!parsed) {
        noWeight++; // bodyweight, cardio or stretching — correctly left null
        continue;
      }

      if (VERBOSE) {
        console.log(
          `\n${entry.date} ${entry.exerciseName}\n  segment: ${JSON.stringify(segment)}\n` +
            `  records: ${JSON.stringify(parsed.records)}`
        );
      }

      const repsFix =
        FIX_REPS && parsed.repsPerSet !== null &&
        (parsed.sets !== entry.sets || parsed.repsPerSet !== entry.reps);

      const sets = repsFix ? parsed.sets : entry.sets ?? 0;
      const reps = repsFix ? parsed.repsPerSet! : entry.reps ?? 0;

      proposals.push({
        user: usernameById.get(entry.userId) ?? entry.userId,
        date: entry.date,
        exercise: entry.exerciseName.slice(0, 30),
        stored: `${entry.sets ?? "—"}×${entry.reps ?? "—"}`,
        parsed: `${parsed.sets}×${parsed.repsPerSet ?? "—"}`,
        kg: parsed.weightKg,
        volume: Math.round(parsed.weightKg * sets * reps),
        repsFix,
      });

      if (APPLY) {
        await prisma.workoutEntry.update({
          where: { id: entry.id },
          data: {
            weightKg: parsed.weightKg,
            ...(repsFix ? { sets: parsed.sets, reps: parsed.repsPerSet } : {}),
          },
        });
      }
    }
  }

  console.table(proposals.map(({ repsFix, ...row }) => ({ ...row, fix: repsFix ? "✓" : "" })));

  const totalVolume = proposals.reduce((s, p) => s + p.volume, 0);
  console.log(
    `\n${proposals.length} rows ${APPLY ? "updated" : "would be updated"} · ` +
      `${totalVolume.toLocaleString()} kg of volume recovered · ` +
      `${noWeight} rows have no load in the text (left null) · ` +
      `${unanchored.length} could not be located in their log`
  );
  if (unanchored.length) console.log(`Not located: ${unanchored.join(", ")}`);
  if (!APPLY && proposals.length) console.log("Re-run with --apply to write these.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
