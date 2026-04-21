import { z } from "zod";
import { callLlm, extractJson } from "./llm-client";

const MonthlySummarySchema = z.object({
  summary: z.string(),
  highlights: z.array(z.string()),
  suggestions: z.array(z.string()),
  coachingInsight: z.string().nullable().optional(),
  overallGrade: z.enum(["A", "B", "C", "D", "F"]),
});

export type MonthlySummaryResponse = z.infer<typeof MonthlySummarySchema>;

export type MonthlyDay = {
  date: string;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  workoutKcal: number;
  hasWorkout: boolean;
};

export type MonthlyWeight = { date: string; weightKg: number };

export type MonthlySummaryInput = {
  days: MonthlyDay[];
  targets: { kcal: number; protein: number; carbs: number; fat: number; fiber: number | null };
  weights: MonthlyWeight[];
  rangeDays: number;
};

export type MonthlySignals = {
  rangeDays: number;
  loggedDays: number;
  coveragePct: number;
  avgKcal: number;
  avgProtein: number;
  avgFiber: number;
  targetKcal: number;
  targetProtein: number;
  targetFiber: number | null;
  weekdayAvgKcal: number | null;
  weekendAvgKcal: number | null;
  bestDay: { date: string; kcal: number } | null;
  worstOverDay: { date: string; kcal: number; overBy: number } | null;
  kcalConsistencyCv: number | null;
  proteinConsistencyCv: number | null;
  workoutDays: number;
  totalBurned: number;
  trainingDayAvgKcal: number | null;
  restDayAvgKcal: number | null;
  currentStreak: number;
  weightStart: number | null;
  weightEnd: number | null;
  weightChangeKg: number | null;
  weighInCount: number;
  expectedWeightChangeKg: number | null;
  accuracyVerdict: "aligned" | "under-logging-suspected" | "over-logging-suspected" | "insufficient-data";
};

function isWeekend(iso: string): boolean {
  const d = new Date(iso + "T00:00:00");
  const wd = d.getDay();
  return wd === 0 || wd === 6;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const v = xs.reduce((s, x) => s + (x - m) * (x - m), 0) / (xs.length - 1);
  return Math.sqrt(v);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function deriveMonthlySignals(input: MonthlySummaryInput): MonthlySignals {
  const logged = input.days.filter((d) => d.kcal > 0);
  const loggedDays = logged.length;
  const coveragePct = Math.round((loggedDays / input.rangeDays) * 100);

  const kcalValues = logged.map((d) => d.kcal);
  const proteinValues = logged.map((d) => d.protein);
  const fiberValues = logged.map((d) => d.fiber);

  const avgKcal = Math.round(mean(kcalValues));
  const avgProtein = round1(mean(proteinValues));
  const avgFiber = round1(mean(fiberValues));

  const weekdayKcal = logged.filter((d) => !isWeekend(d.date)).map((d) => d.kcal);
  const weekendKcal = logged.filter((d) => isWeekend(d.date)).map((d) => d.kcal);

  const weekdayAvgKcal = weekdayKcal.length > 0 ? Math.round(mean(weekdayKcal)) : null;
  const weekendAvgKcal = weekendKcal.length > 0 ? Math.round(mean(weekendKcal)) : null;

  let bestDay: MonthlySignals["bestDay"] = null;
  let worstOverDay: MonthlySignals["worstOverDay"] = null;
  for (const d of logged) {
    const diff = Math.abs(d.kcal - input.targets.kcal);
    if (!bestDay || diff < Math.abs(bestDay.kcal - input.targets.kcal)) {
      bestDay = { date: d.date, kcal: Math.round(d.kcal) };
    }
    const over = d.kcal - input.targets.kcal;
    if (over > 0 && (!worstOverDay || over > worstOverDay.overBy)) {
      worstOverDay = { date: d.date, kcal: Math.round(d.kcal), overBy: Math.round(over) };
    }
  }

  const kcalCv = avgKcal > 0 ? Math.round((stddev(kcalValues) / avgKcal) * 100) : null;
  const proteinCv = avgProtein > 0 ? Math.round((stddev(proteinValues) / avgProtein) * 100) : null;

  const workoutLogged = input.days.filter((d) => d.hasWorkout);
  const workoutDays = workoutLogged.length;
  const totalBurned = Math.round(input.days.reduce((s, d) => s + d.workoutKcal, 0));

  const trainingEatingDays = logged.filter((d) => d.hasWorkout).map((d) => d.kcal);
  const restEatingDays = logged.filter((d) => !d.hasWorkout).map((d) => d.kcal);
  const trainingDayAvgKcal = trainingEatingDays.length > 0 ? Math.round(mean(trainingEatingDays)) : null;
  const restDayAvgKcal = restEatingDays.length > 0 ? Math.round(mean(restEatingDays)) : null;

  // Current streak: count consecutive logged days at the tail
  const sorted = [...input.days].sort((a, b) => a.date.localeCompare(b.date));
  let currentStreak = 0;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].kcal > 0) currentStreak++;
    else break;
  }

  // Weight correlation
  const weights = [...input.weights].sort((a, b) => a.date.localeCompare(b.date));
  const weightStart = weights.length > 0 ? weights[0].weightKg : null;
  const weightEnd = weights.length > 0 ? weights[weights.length - 1].weightKg : null;
  const weightChangeKg =
    weightStart !== null && weightEnd !== null ? round1(weightEnd - weightStart) : null;

  let expectedWeightChangeKg: number | null = null;
  let accuracyVerdict: MonthlySignals["accuracyVerdict"] = "insufficient-data";

  if (weights.length >= 2 && loggedDays >= 10) {
    const avgBurnPerLoggedDay = loggedDays > 0 ? totalBurned / input.rangeDays : 0;
    const avgNetBalance = avgKcal - input.targets.kcal - avgBurnPerLoggedDay;
    // Scale by days in the weigh-in window (approximate using loggedDays)
    const firstDate = new Date(weights[0].date + "T00:00:00");
    const lastDate = new Date(weights[weights.length - 1].date + "T00:00:00");
    const daysBetween = Math.max(
      1,
      Math.round((lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24))
    );
    const coverageRatio = Math.min(1, loggedDays / input.rangeDays);
    const effectiveDays = daysBetween * coverageRatio;
    expectedWeightChangeKg = round1((avgNetBalance * effectiveDays) / 7700);

    if (weightChangeKg !== null) {
      const diff = weightChangeKg - expectedWeightChangeKg;
      if (Math.abs(diff) <= 0.7) accuracyVerdict = "aligned";
      else if (diff > 0.7) accuracyVerdict = "under-logging-suspected"; // gained more / lost less than deficit predicts
      else accuracyVerdict = "over-logging-suspected"; // lost more than deficit predicts
    }
  }

  return {
    rangeDays: input.rangeDays,
    loggedDays,
    coveragePct,
    avgKcal,
    avgProtein,
    avgFiber,
    targetKcal: input.targets.kcal,
    targetProtein: input.targets.protein,
    targetFiber: input.targets.fiber,
    weekdayAvgKcal,
    weekendAvgKcal,
    bestDay,
    worstOverDay,
    kcalConsistencyCv: kcalCv,
    proteinConsistencyCv: proteinCv,
    workoutDays,
    totalBurned,
    trainingDayAvgKcal,
    restDayAvgKcal,
    currentStreak,
    weightStart,
    weightEnd,
    weightChangeKg,
    weighInCount: weights.length,
    expectedWeightChangeKg,
    accuracyVerdict,
  };
}

const SYSTEM = `You are a friendly, pragmatic nutrition coach. Given a month of pre-computed signals, write an honest performance summary. Do NOT invent numbers — only use the values provided. Be specific and encouraging but direct about issues. Return ONLY valid JSON.`;

function formatSignalsForPrompt(s: MonthlySignals): string {
  const lines: string[] = [];
  lines.push(`Coverage: ${s.loggedDays}/${s.rangeDays} days logged (${s.coveragePct}%)`);
  lines.push(`Current streak: ${s.currentStreak} days`);
  lines.push(`Avg calories: ${s.avgKcal} (target ${s.targetKcal})`);
  lines.push(`Avg protein: ${s.avgProtein}g (target ${s.targetProtein}g)`);
  if (s.targetFiber !== null) lines.push(`Avg fiber: ${s.avgFiber}g (target ${s.targetFiber}g)`);
  if (s.weekdayAvgKcal !== null && s.weekendAvgKcal !== null) {
    lines.push(`Weekday avg: ${s.weekdayAvgKcal} kcal · Weekend avg: ${s.weekendAvgKcal} kcal`);
  }
  if (s.bestDay) lines.push(`Closest-to-target day: ${s.bestDay.date} (${s.bestDay.kcal} kcal)`);
  if (s.worstOverDay) lines.push(`Biggest overshoot: ${s.worstOverDay.date} (${s.worstOverDay.kcal} kcal, +${s.worstOverDay.overBy} over)`);
  if (s.kcalConsistencyCv !== null) lines.push(`Calorie consistency (CV): ${s.kcalConsistencyCv}% (lower = steadier)`);
  if (s.proteinConsistencyCv !== null) lines.push(`Protein consistency (CV): ${s.proteinConsistencyCv}%`);
  lines.push(`Workouts: ${s.workoutDays} days, ${s.totalBurned} kcal burned total`);
  if (s.trainingDayAvgKcal !== null && s.restDayAvgKcal !== null) {
    lines.push(`Training-day avg: ${s.trainingDayAvgKcal} kcal · Rest-day avg: ${s.restDayAvgKcal} kcal`);
  }
  if (s.weightStart !== null && s.weightEnd !== null && s.weightChangeKg !== null) {
    lines.push(`Weight: ${s.weightStart}kg → ${s.weightEnd}kg (${s.weightChangeKg >= 0 ? "+" : ""}${s.weightChangeKg}kg, ${s.weighInCount} weigh-ins)`);
  }
  if (s.expectedWeightChangeKg !== null) {
    lines.push(`Expected weight change from calorie balance: ${s.expectedWeightChangeKg >= 0 ? "+" : ""}${s.expectedWeightChangeKg}kg`);
    lines.push(`Accuracy verdict: ${s.accuracyVerdict}`);
  }
  return lines.join("\n");
}

export async function generateMonthlySummary(
  input: MonthlySummaryInput
): Promise<{ signals: MonthlySignals; summary: MonthlySummaryResponse }> {
  const signals = deriveMonthlySignals(input);

  const prompt = `Here are this month's pre-computed signals:

${formatSignalsForPrompt(signals)}

Return ONLY a JSON object in this exact shape:
{
  "summary": "3-4 sentence paragraph covering the big picture",
  "highlights": ["specific win with numbers", "another win", "..."],
  "suggestions": ["actionable suggestion", "another one"],
  "coachingInsight": "ONE sentence about logging accuracy based on the accuracy verdict and weight data — or null if verdict is insufficient-data",
  "overallGrade": "A"
}

Rules:
- Use ONLY numbers from the signals above. Do not invent any.
- overallGrade: A = hit most targets, B = decent, C = needs work, D/F = far off. Factor in coverage — inconsistent logging should cap the grade at B.
- 3-5 highlights, 2-3 suggestions.
- If accuracyVerdict is "under-logging-suspected", the coachingInsight should gently flag that real intake likely exceeds what was logged.
- If "over-logging-suspected", flag that weight dropped more than calorie balance predicts (could be water, stress, or measurement noise).
- If "aligned", affirm that the user's logging appears accurate.
- If "insufficient-data", set coachingInsight to null.
- Call out weekend vs weekday gap if > 300 kcal.
- Call out training-day vs rest-day eating if difference is unusual (e.g. eating less on training days).`;

  const text = await callLlm(SYSTEM, prompt);
  const summary = MonthlySummarySchema.parse(extractJson(text));
  return { signals, summary };
}
