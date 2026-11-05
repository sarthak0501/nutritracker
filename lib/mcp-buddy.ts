import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { mcpCalendarDate } from "@/lib/mcp-nutrition";
import { McpMutationError } from "@/lib/mcp-mutations";
import { mealDateSchema } from "@/lib/meal-writes";
import { entryAmountLabel } from "@/lib/meal-units";
import { safeNutrientsForEntry } from "@/lib/nutrition";

export const BuddyDaySchema = z.object({
  buddyId: z.string().trim().min(1).max(200).optional().describe("An accepted buddy ID from get_buddy_meals. May be omitted only when exactly one buddy is connected."),
  date: mealDateSchema.optional().describe("Calendar date YYYY-MM-DD; defaults to today in NutriTracker's calendar."),
}).strict();
const LIMIT = 200;
const unavailable = () => new McpMutationError("This buddy's daily log is not available to your account. Check your accepted buddies with get_buddy_meals.");
const knownNonnegative = (value: number | null) => value !== null && Number.isFinite(value) && value >= 0 ? value : null;

/** Read only the food/workout information exposed by the website buddy feed. */
export async function getMcpBuddyDay(userId: string, input: z.input<typeof BuddyDaySchema> = {}, client: PrismaClient = prisma) {
  const parsed = BuddyDaySchema.parse(input);
  const date = parsed.date ?? mcpCalendarDate();
  return client.$transaction(async tx => {
    // A relationship authorizes every read in this transaction. Holding a share
    // lock prevents a concurrent removal/status change between check and read.
    // At most two opposite-direction rows can exist for one buddy, so three
    // rows suffice to detect ambiguous automatic selection without a full scan.
    const requested = parsed.buddyId ? Prisma.sql`AND ("requesterId" = ${parsed.buddyId} OR "addresseeId" = ${parsed.buddyId})` : Prisma.empty;
    const relationships = await tx.$queryRaw<Array<{ requesterId: string; addresseeId: string }>>(Prisma.sql`
      SELECT "requesterId", "addresseeId" FROM "BuddyRelationship"
      WHERE "status" = 'ACCEPTED' AND ("requesterId" = ${userId} OR "addresseeId" = ${userId})
      ${requested} ORDER BY "id" LIMIT 3 FOR SHARE`);
    const buddyIds = [...new Set(relationships.map(row => row.requesterId === userId ? row.addresseeId : row.requesterId))].filter(id => id !== userId);
    if (!buddyIds.length || parsed.buddyId === userId) throw unavailable();
    if (buddyIds.length !== 1) throw new McpMutationError("More than one buddy is connected. Use get_buddy_meals and ask which buddy's daily log to view.");
    const buddyId = buddyIds[0];
    if (parsed.buddyId !== undefined && buddyId !== parsed.buddyId) throw unavailable();
    const buddy = await tx.user.findUnique({ where: { id: buddyId }, select: { id: true, username: true } });
    if (!buddy) throw unavailable();
    const foods = await tx.logEntry.findMany({ where: { userId: buddyId, date }, include: { food: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: LIMIT + 1 });
    const activity = await tx.workoutEntry.findMany({ where: { userId: buddyId, date },
      select: { id: true, exerciseName: true, muscleGroup: true, durationMinutes: true, sets: true, reps: true, weightKg: true, caloriesBurned: true, isEstimated: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: LIMIT + 1 });
    const entries = foods.slice(0, LIMIT).map(entry => ({ id: entry.id, mealType: entry.mealType,
      food: entry.food.name, brand: entry.food.brand, amount: entry.amount, unit: entry.unit,
      portionLabel: entryAmountLabel(entry, entry.food), isEstimated: entry.isEstimated,
      nutrients: safeNutrientsForEntry(entry, entry.food) }));
    const workouts = activity.slice(0, LIMIT).map(entry => ({ id: entry.id, exerciseName: entry.exerciseName,
      muscleGroup: entry.muscleGroup, durationMinutes: entry.durationMinutes, sets: entry.sets, reps: entry.reps,
      weightKg: entry.weightKg, caloriesBurned: knownNonnegative(entry.caloriesBurned), caloriesAreEstimated: entry.isEstimated }));
    const totals = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: null as number | null };
    for (const entry of entries) {
      const n = entry.nutrients;
      if (!n) continue;
      totals.kcal += n.kcal; totals.protein_g += n.protein_g; totals.carbs_g += n.carbs_g; totals.fat_g += n.fat_g;
      if (n.fiber_g != null) totals.fiber_g = (totals.fiber_g ?? 0) + n.fiber_g;
    }
    const entriesMissingNutrition = entries.filter(entry => entry.nutrients === null).length;
    const entriesMissingFiber = entries.filter(entry => entry.nutrients?.fiber_g == null).length;
    const entriesTruncated = foods.length > LIMIT;
    const workoutsTruncated = activity.length > LIMIT;
    return { buddy, date, entries, workouts, totals, entriesTruncated, workoutsTruncated,
      totalsScope: entriesTruncated ? "returned_entries_only" : "all_recorded_food_entries_for_date",
      entriesMissingNutrition, entriesMissingFiber,
      nutritionCompleteForRecordedEntries: !entriesTruncated && entriesMissingNutrition === 0,
      fiberCompleteForRecordedEntries: !entriesTruncated && entriesMissingFiber === 0,
      knownEstimatedCaloriesBurned: workouts.reduce((sum, entry) => sum + (entry.caloriesBurned ?? 0), 0),
      workoutsMissingCalories: workouts.filter(entry => entry.caloriesBurned === null).length,
      workoutTotalsScope: workoutsTruncated ? "returned_entries_only" : "all_recorded_workout_entries_for_date",
      coverageNote: "Shows only food and workout records shared by an accepted buddy, matching the website buddy feed. Missing logs are unknown, not zero intake or a rest day. Nutrition totals exclude unknown values; fiber may be partial. Workout calories are estimates, with unrecorded values left unknown, and are separate from food totals. At most 200 foods and 200 exercises are returned; truncation flags identify partial totals." };
  }, { timeout: 20_000 });
}
