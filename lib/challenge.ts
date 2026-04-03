import { prisma } from "@/lib/db";
import type { LogEntry, Food } from "@prisma/client";
import { safeNutrientsForEntry } from "./nutrition";

export const MAX_PER_DAY = 11; // 3+2+2+1+1+2 bonus
export const MAX_PER_WEEK = MAX_PER_DAY * 7; // 77

export type Breakdown = {
  calories: boolean;
  protein: boolean;
  workout: boolean;
  fiber: boolean;
  meals: boolean;
  perfect: boolean;
};

export type DayScore = {
  date: string;
  points: number;
  breakdown: Breakdown;
};

export type WeekResult = {
  weekStart: string;
  days: string[];
  myScores: DayScore[];
  buddyScores: DayScore[];
  myTotal: number;
  buddyTotal: number;
  winner: "me" | "buddy" | "tie";
};

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function currentWeekMonday(): string {
  const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  const [y, m, d] = todayStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const dow = date.getDay();
  const offset = dow === 0 ? 6 : dow - 1;
  date.setDate(date.getDate() - offset);
  return isoDate(date);
}

export function getWeekDates(mondayIso: string): string[] {
  const [y, m, d] = mondayIso.split("-").map(Number);
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(y, m - 1, d + i);
    return isoDate(date);
  });
}

function mondayNWeeksAgo(n: number): string {
  const [y, m, d] = currentWeekMonday().split("-").map(Number);
  const date = new Date(y, m - 1, d - n * 7);
  return isoDate(date);
}

type ProfileData = { kcalTarget: number; proteinTarget: number; fiberTarget: number | null };
type EntryWithFood = LogEntry & { food: Food };

function scoreDays(
  days: string[],
  entries: EntryWithFood[],
  workoutDates: string[],
  profile: ProfileData
): DayScore[] {
  return days.map((date) => {
    const dayEntries = entries.filter((e) => e.date === date);
    const hasWorkout = workoutDates.includes(date);

    if (dayEntries.length === 0 && !hasWorkout) {
      return {
        date,
        points: 0,
        breakdown: { calories: false, protein: false, workout: false, fiber: false, meals: false, perfect: false },
      };
    }

    let kcal = 0, protein = 0, fiber = 0;
    const mealTypes = new Set<string>();
    for (const e of dayEntries) {
      const n = safeNutrientsForEntry(e, e.food);
      if (!n) continue;
      kcal += n.kcal;
      protein += n.protein_g;
      fiber += n.fiber_g ?? 0;
      mealTypes.add(e.mealType);
    }

    const caloriesHit =
      dayEntries.length > 0 && Math.abs(kcal - profile.kcalTarget) / profile.kcalTarget <= 0.1;
    const proteinHit = protein >= profile.proteinTarget * 0.9;
    const workoutLogged = hasWorkout;
    const fiberHit = fiber >= (profile.fiberTarget ?? 30) * 0.9;
    const mealsHit =
      mealTypes.has("BREAKFAST") && mealTypes.has("LUNCH") && mealTypes.has("DINNER");
    const perfect = caloriesHit && proteinHit && workoutLogged && fiberHit && mealsHit;

    const points =
      (caloriesHit ? 3 : 0) +
      (proteinHit ? 2 : 0) +
      (workoutLogged ? 2 : 0) +
      (fiberHit ? 1 : 0) +
      (mealsHit ? 1 : 0) +
      (perfect ? 2 : 0);

    return {
      date,
      points,
      breakdown: { calories: caloriesHit, protein: proteinHit, workout: workoutLogged, fiber: fiberHit, meals: mealsHit, perfect },
    };
  });
}

export type AllTimeStats = {
  myWins: number;
  buddyWins: number;
  ties: number;
  myTotalPoints: number;
  buddyTotalPoints: number;
};

export async function getChallengeData(
  userId: string,
  buddyId: string
): Promise<{ currentWeek: WeekResult; pastWeeks: WeekResult[]; allTime: AllTimeStats }> {
  const thisMonday = currentWeekMonday();
  const HISTORY_WEEKS = 12;
  const pastMondays = Array.from({ length: HISTORY_WEEKS }, (_, i) => mondayNWeeksAgo(i + 1));
  const allMondays = [thisMonday, ...pastMondays];

  const rangeStart = pastMondays[pastMondays.length - 1];
  const rangeEnd = getWeekDates(thisMonday)[6];

  const [myEntries, buddyEntries, myWorkouts, buddyWorkouts, myProfile, buddyProfile] =
    await Promise.all([
      prisma.logEntry.findMany({
        where: { userId, date: { gte: rangeStart, lte: rangeEnd } },
        include: { food: true },
      }),
      prisma.logEntry.findMany({
        where: { userId: buddyId, date: { gte: rangeStart, lte: rangeEnd } },
        include: { food: true },
      }),
      prisma.workoutEntry.findMany({
        where: { userId, date: { gte: rangeStart, lte: rangeEnd } },
        select: { date: true },
      }),
      prisma.workoutEntry.findMany({
        where: { userId: buddyId, date: { gte: rangeStart, lte: rangeEnd } },
        select: { date: true },
      }),
      prisma.profile.findUnique({ where: { userId } }),
      prisma.profile.findUnique({ where: { userId: buddyId } }),
    ]);

  const myProf: ProfileData = {
    kcalTarget: myProfile?.kcalTarget ?? 2000,
    proteinTarget: myProfile?.proteinTarget ?? 120,
    fiberTarget: myProfile?.fiberTarget ?? 30,
  };
  const buddyProf: ProfileData = {
    kcalTarget: buddyProfile?.kcalTarget ?? 2000,
    proteinTarget: buddyProfile?.proteinTarget ?? 120,
    fiberTarget: buddyProfile?.fiberTarget ?? 30,
  };

  const myWorkoutDates = myWorkouts.map((w) => w.date);
  const buddyWorkoutDates = buddyWorkouts.map((w) => w.date);

  function buildWeek(mondayIso: string): WeekResult {
    const days = getWeekDates(mondayIso);
    const myScores = scoreDays(days, myEntries as EntryWithFood[], myWorkoutDates, myProf);
    const buddyScores = scoreDays(days, buddyEntries as EntryWithFood[], buddyWorkoutDates, buddyProf);
    const myTotal = myScores.reduce((s, d) => s + d.points, 0);
    const buddyTotal = buddyScores.reduce((s, d) => s + d.points, 0);
    const winner = myTotal > buddyTotal ? "me" : buddyTotal > myTotal ? "buddy" : "tie";
    return { weekStart: mondayIso, days, myScores, buddyScores, myTotal, buddyTotal, winner };
  }

  const [currentWeek, ...pastWeeksReversed] = allMondays.map(buildWeek);
  const pastWeeks = pastWeeksReversed.reverse();

  const allTime: AllTimeStats = pastWeeks.reduce(
    (acc, w) => {
      if (w.myTotal === 0 && w.buddyTotal === 0) return acc; // skip empty weeks
      acc.myTotalPoints += w.myTotal;
      acc.buddyTotalPoints += w.buddyTotal;
      if (w.winner === "me") acc.myWins++;
      else if (w.winner === "buddy") acc.buddyWins++;
      else acc.ties++;
      return acc;
    },
    { myWins: 0, buddyWins: 0, ties: 0, myTotalPoints: 0, buddyTotalPoints: 0 }
  );

  return { currentWeek, pastWeeks, allTime };
}
