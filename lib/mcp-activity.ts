import { Prisma, type PrismaClient, type WorkoutEntry } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { mealDateSchema } from "@/lib/meal-writes";
import { mcpCalendarDate, McpNutritionError } from "@/lib/mcp-nutrition";
import { withMcpMutation } from "@/lib/mcp-mutations";

const requestId = z.string().trim().min(1).max(128).describe("Unique ID for this change. Reuse the exact ID and input on retries; use a new ID for a different change.");
const recordId = z.string().min(1).max(128);
const expectedUpdatedAt = z.string().datetime().describe("Exact updatedAt returned by get_workouts; reread before correcting or deleting a record.");
const rangeFields = {
  endDate: mealDateSchema.optional().describe("Inclusive last date, YYYY-MM-DD; defaults to today in NutriTracker's calendar."),
  days: z.number().int().min(1).max(366).default(31),
};
const exerciseFields = {
  exerciseName: z.string().trim().min(1).max(160),
  muscleGroup: z.string().trim().min(1).max(80).nullable().optional(),
  durationMinutes: z.number().finite().positive().max(1440).nullable().optional(),
  sets: z.number().int().min(1).max(100).nullable().optional(),
  reps: z.number().int().min(1).max(1000).nullable().optional(),
  weightKg: z.number().finite().min(0).max(2000).nullable().optional().describe("Actual load lifted in kilograms; for dumbbells, one dumbbell's weight. Clarify units before saving."),
  caloriesBurned: z.number().finite().min(0).max(20_000).nullable().optional().describe("Only a burn figure explicitly supplied by the person or their device. Otherwise omit; do not invent a calorie estimate."),
};
function hasExerciseDetails(exercise: { durationMinutes?: number | null; sets?: number | null; reps?: number | null }) {
  return exercise.durationMinutes != null || (exercise.sets != null && exercise.reps != null);
}
const ExerciseSchema = z.object(exerciseFields).strict().refine(hasExerciseDetails, "Provide duration or both sets and reps for each exercise.");
export const WorkoutHistorySchema = z.object({
  ...rangeFields,
  exerciseName: z.string().trim().min(1).max(160).optional().describe("Optional case-insensitive exercise-name search, for example bench press."),
  limit: z.number().int().min(1).max(1000).default(200),
}).strict();
export const LogWorkoutSchema = z.object({
  requestId,
  date: mealDateSchema,
  completed: z.literal(true).describe("Must be true: save only exercises the person says they actually completed; a plan is not a completed workout."),
  exercises: z.array(ExerciseSchema).min(1).max(50),
}).strict();
export const UpdateWorkoutSchema = z.object({
  requestId,
  entryId: recordId,
  expectedUpdatedAt,
  changes: z.object({ ...exerciseFields, exerciseName: exerciseFields.exerciseName.optional(), date: mealDateSchema.optional() }).strict()
    .refine(value => Object.values(value).some(item => item !== undefined), "Provide at least one field to change."),
}).strict();
export const DeleteWorkoutSchema = z.object({ requestId, entryId: recordId, expectedUpdatedAt }).strict();
export const MeasurementsSchema = z.object(rangeFields).strict();
export const SetWaterSchema = z.object({
  requestId, date: mealDateSchema,
  glasses: z.number().int().min(0).max(100).describe("New total glasses for this date, not an increment. Read the current total first."),
  expectedGlasses: z.number().int().min(0).max(100).describe("Current total returned by get_measurements or get_day; use zero for an absent record."),
}).strict();
export const SetWeightSchema = z.object({
  requestId, date: mealDateSchema,
  weightKg: z.number().finite().min(20).max(500),
  expectedWeightKg: z.number().finite().min(20).max(500).nullable().describe("Current recorded weight for that date; null means no entry exists. Read get_measurements first."),
}).strict();
export const DeleteWeightSchema = z.object({
  requestId, date: mealDateSchema,
  expectedWeightKg: z.number().finite().min(20).max(500).describe("Exact recorded weight returned by get_measurements."),
}).strict();

function dateRange(input: { endDate?: string; days: number }) {
  const endDate = input.endDate ?? mcpCalendarDate();
  const start = new Date(`${endDate}T00:00:00.000Z`);
  start.setUTCDate(start.getUTCDate() - input.days + 1);
  return { startDate: start.toISOString().slice(0, 10), endDate };
}
function completedDate(date: string) {
  if (date > mcpCalendarDate()) throw new McpNutritionError("Completed workouts and measurements cannot be logged for a future date. Confirm the actual date.");
}
function stale(kind: string): never {
  throw new McpNutritionError(`The ${kind} changed or is unavailable. Read the current record, confirm the intended correction, and retry with a new request ID.`);
}
function workoutRecord(entry: WorkoutEntry) {
  return {
    id: entry.id, date: entry.date, exerciseName: entry.exerciseName, muscleGroup: entry.muscleGroup,
    durationMinutes: entry.durationMinutes, sets: entry.sets, reps: entry.reps, weightKg: entry.weightKg,
    caloriesBurned: entry.caloriesBurned, caloriesAreEstimated: entry.isEstimated,
    updatedAt: entry.updatedAt.toISOString(),
  };
}
const calorieNote = "Workout calories are estimates and stay separate from food targets. Missing calorie values are unknown, not zero. Session count is not inferred from individual exercise entries.";

export async function getMcpWorkouts(userId: string, input: z.input<typeof WorkoutHistorySchema> = {}, client: PrismaClient = prisma) {
  const parsed = WorkoutHistorySchema.parse(input);
  const { startDate, endDate } = dateRange(parsed);
  const entries = await client.workoutEntry.findMany({
    where: { userId, date: { gte: startDate, lte: endDate }, ...(parsed.exerciseName ? { exerciseName: { contains: parsed.exerciseName, mode: "insensitive" as const } } : {}) },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }, { id: "asc" }], take: parsed.limit + 1,
  });
  const returned = entries.slice(0, parsed.limit);
  const truncated = entries.length > parsed.limit;
  return {
    startDate, endDate, entries: returned.map(workoutRecord), truncated,
    summaryScope: truncated ? "returned_entries_only" : "all_matching_recorded_entries",
    exerciseEntryCount: returned.length, recordedDays: new Set(returned.map(entry => entry.date)).size,
    knownDurationMinutes: returned.reduce((sum, entry) => sum + (entry.durationMinutes ?? 0), 0),
    entriesMissingDuration: returned.filter(entry => entry.durationMinutes == null).length,
    knownEstimatedCaloriesBurned: returned.reduce((sum, entry) => sum + (entry.caloriesBurned ?? 0), 0),
    entriesMissingCalories: returned.filter(entry => entry.caloriesBurned == null).length,
    coverageNote: `${calorieNote} Unlogged dates do not establish rest days.${truncated ? " Request a shorter date range or a more specific exercise name to see remaining entries." : ""}`,
  };
}

export async function logMcpWorkout(userId: string, input: z.input<typeof LogWorkoutSchema>, client: PrismaClient = prisma) {
  const parsed = LogWorkoutSchema.parse(input);
  completedDate(parsed.date);
  return withMcpMutation(userId, parsed.requestId, "workout.log", parsed, async tx => {
    const entries = [];
    for (const exercise of parsed.exercises) {
      entries.push(workoutRecord(await tx.workoutEntry.create({ data: {
        userId, date: parsed.date, exerciseName: exercise.exerciseName, muscleGroup: exercise.muscleGroup ?? null,
        durationMinutes: exercise.durationMinutes ?? null, sets: exercise.sets ?? null, reps: exercise.reps ?? null,
        weightKg: exercise.weightKg ?? null, caloriesBurned: exercise.caloriesBurned ?? null,
        isEstimated: exercise.caloriesBurned != null, sourceText: "Recorded through assistant",
        estimationMeta: { source: "mcp", calorieSource: exercise.caloriesBurned == null ? "unknown" : "user_reported" },
      } })));
    }
    return { saved: true, date: parsed.date, entries, calorieNote };
  }, client);
}

export async function updateMcpWorkout(userId: string, input: z.input<typeof UpdateWorkoutSchema>, client: PrismaClient = prisma) {
  const parsed = UpdateWorkoutSchema.parse(input);
  if (parsed.changes.date) completedDate(parsed.changes.date);
  return withMcpMutation(userId, parsed.requestId, "workout.update", parsed, async tx => {
    const entry = await tx.workoutEntry.findFirst({ where: { userId, id: parsed.entryId } });
    if (!entry) stale("workout");
    const merged = { ...entry, ...parsed.changes };
    if (!hasExerciseDetails(merged)) throw new McpNutritionError("Keep a duration or both sets and reps for the exercise.");
    const calorieChange = parsed.changes.caloriesBurned !== undefined;
    const changed = await tx.workoutEntry.updateMany({
      where: { userId, id: parsed.entryId, updatedAt: new Date(parsed.expectedUpdatedAt) },
      data: { ...parsed.changes, updatedAt: new Date(Math.max(Date.now(), entry.updatedAt.getTime() + 1)), ...(calorieChange ? { isEstimated: parsed.changes.caloriesBurned != null, estimationMeta: { source: "mcp", calorieSource: parsed.changes.caloriesBurned == null ? "unknown" : "user_reported" } } : {}) },
    });
    if (changed.count !== 1) stale("workout");
    const updated = await tx.workoutEntry.findFirstOrThrow({ where: { userId, id: parsed.entryId } });
    return { saved: true, entry: workoutRecord(updated), calorieNote };
  }, client);
}

export async function deleteMcpWorkout(userId: string, input: z.input<typeof DeleteWorkoutSchema>, client: PrismaClient = prisma) {
  const parsed = DeleteWorkoutSchema.parse(input);
  return withMcpMutation(userId, parsed.requestId, "workout.delete", parsed, async tx => {
    const removed = await tx.workoutEntry.deleteMany({ where: { userId, id: parsed.entryId, updatedAt: new Date(parsed.expectedUpdatedAt) } });
    if (removed.count !== 1) stale("workout");
    return { deleted: true, entryId: parsed.entryId };
  }, client);
}

export async function getMcpMeasurements(userId: string, input: z.input<typeof MeasurementsSchema> = {}, client: PrismaClient = prisma) {
  const parsed = MeasurementsSchema.parse(input);
  const { startDate, endDate } = dateRange(parsed);
  const where = { userId, date: { gte: startDate, lte: endDate } };
  const [water, weight] = await Promise.all([
    client.waterEntry.findMany({ where, orderBy: { date: "desc" }, select: { date: true, glasses: true } }),
    client.weightEntry.findMany({ where, orderBy: { date: "desc" }, select: { date: true, weightKg: true } }),
  ]);
  return { startDate, endDate, water, weight, coverageNote: "Only recorded dates are returned. Missing water entries have a stored total of zero glasses but do not establish no water was consumed. Missing weight entries are unknown. Water is tracked as glasses; no glass-to-milliliter conversion is configured." };
}

async function createOrConflict(run: () => Promise<unknown>, kind: string) {
  try { await run(); }
  catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") stale(kind);
    throw error;
  }
}
export async function setMcpWater(userId: string, input: z.input<typeof SetWaterSchema>, client: PrismaClient = prisma) {
  const parsed = SetWaterSchema.parse(input);
  completedDate(parsed.date);
  return withMcpMutation(userId, parsed.requestId, "water.set", parsed, async tx => {
    const entry = await tx.waterEntry.findUnique({ where: { userId_date: { userId, date: parsed.date } } });
    if ((entry?.glasses ?? 0) !== parsed.expectedGlasses) stale("water total");
    if (entry) {
      const changed = await tx.waterEntry.updateMany({ where: { userId, date: parsed.date, glasses: parsed.expectedGlasses }, data: { glasses: parsed.glasses } });
      if (changed.count !== 1) stale("water total");
    } else {
      await createOrConflict(() => tx.waterEntry.create({ data: { userId, date: parsed.date, glasses: parsed.glasses } }), "water total");
    }
    return { saved: true, date: parsed.date, glasses: parsed.glasses };
  }, client);
}

/** Weigh-in history is independent of the profile used for nutrition targets. */
export async function setMcpWeight(userId: string, input: z.input<typeof SetWeightSchema>, client: PrismaClient = prisma) {
  const parsed = SetWeightSchema.parse(input);
  completedDate(parsed.date);
  return withMcpMutation(userId, parsed.requestId, "weight.set", parsed, async tx => {
    const entry = await tx.weightEntry.findUnique({ where: { userId_date: { userId, date: parsed.date } } });
    if ((entry?.weightKg ?? null) !== parsed.expectedWeightKg) stale("weight entry");
    if (entry) {
      const changed = await tx.weightEntry.updateMany({ where: { userId, date: parsed.date, weightKg: parsed.expectedWeightKg! }, data: { weightKg: parsed.weightKg } });
      if (changed.count !== 1) stale("weight entry");
    } else {
      await createOrConflict(() => tx.weightEntry.create({ data: { userId, date: parsed.date, weightKg: parsed.weightKg } }), "weight entry");
    }
    return { saved: true, date: parsed.date, weightKg: parsed.weightKg };
  }, client);
}

export async function deleteMcpWeight(userId: string, input: z.input<typeof DeleteWeightSchema>, client: PrismaClient = prisma) {
  const parsed = DeleteWeightSchema.parse(input);
  return withMcpMutation(userId, parsed.requestId, "weight.delete", parsed, async tx => {
    const deleted = await tx.weightEntry.deleteMany({ where: { userId, date: parsed.date, weightKg: parsed.expectedWeightKg } });
    if (deleted.count !== 1) stale("weight entry");
    return { deleted: true, date: parsed.date };
  }, client);
}
