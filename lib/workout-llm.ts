import { z } from "zod";
import { callLlm, extractJson } from "./llm-client";
import { llmNumber, llmInt, llmReps, llmMinutes, llmSeconds, llmStrings, llmWeightKg } from "./llm-schema";

// --- Workout Estimation (log) ---

const WorkoutItemSchema = z.object({
  exerciseName: z.string(),
  muscleGroup: z.string().nullish(),
  durationMinutes: llmMinutes(z.number().optional()),
  sets: llmInt(z.number().optional()),
  reps: llmReps(z.number().optional()),
  weightKg: llmWeightKg(z.number().nonnegative().optional()),
  caloriesBurned: llmNumber(z.number().nonnegative()),
  confidence: llmNumber(z.number().min(0).max(1)),
  assumptions: llmStrings(),
});

const WorkoutEstimateResponseSchema = z.object({
  exercises: z.array(WorkoutItemSchema),
  recommendations: llmStrings(),
  notes: llmStrings(),
});

export type WorkoutEstimateResponse = z.infer<typeof WorkoutEstimateResponseSchema>;

// --- Workout Recommendations ---

const RecommendedExerciseSchema = z.object({
  exerciseName: z.string(),
  muscleGroup: z.string().nullish(),
  sets: llmInt(z.number().optional()),
  reps: llmReps(z.number().optional()),
  restSeconds: llmSeconds(z.number().optional()),
  durationMinutes: llmMinutes(z.number().optional()),
  estimatedCalories: llmNumber(z.number().nonnegative()),
  notes: z.string().nullish(),
});

const WorkoutRecommendationResponseSchema = z.object({
  exercises: z.array(RecommendedExerciseSchema),
  warmup: z.string().nullish(),
  cooldown: z.string().nullish(),
  totalEstimatedCalories: llmNumber(z.number().nonnegative()),
  totalDurationMinutes: llmMinutes(z.number()),
  notes: llmStrings(),
});

export type RecommendedExercise = z.infer<typeof RecommendedExerciseSchema>;
export type WorkoutRecommendationResponse = z.infer<typeof WorkoutRecommendationResponseSchema>;

// --- Estimate workout (for logging) ---

const ESTIMATE_SYSTEM = `You are a fitness estimation assistant. Given a workout description, return a JSON object estimating calories burned for each exercise. Use the MET (Metabolic Equivalent of Task) method when possible and factor in the user's weight if provided. Be conservative with calorie estimates.`;

function buildEstimatePrompt(text: string, weightKg?: number) {
  const weightNote = weightKg
    ? `The user weighs ${weightKg} kg. Use this for calorie calculations.`
    : `User weight unknown — assume 70 kg and note this assumption.`;

  return `Estimate the workout: "${text}"

${weightNote}

Return ONLY a JSON object with this exact structure:
{
  "exercises": [
    {
      "exerciseName": "exercise name",
      "muscleGroup": "chest/back/legs/shoulders/arms/core/cardio/full body",
      "durationMinutes": 30,
      "sets": 3,
      "reps": 10,
      "weightKg": 40,
      "caloriesBurned": 150,
      "confidence": 0.8,
      "assumptions": ["assumed moderate intensity"]
    }
  ],
  "recommendations": [],
  "notes": ["any overall notes"]
}

Rules:
- durationMinutes, sets, reps, weightKg are optional — include whichever is relevant
- ALL numeric fields (sets, reps, weightKg, durationMinutes, caloriesBurned, confidence) must be plain JSON numbers, NEVER strings
- weightKg is the load lifted, ALWAYS in kilograms — convert pounds to kg (1 lb = 0.4536 kg), so "100 lb" is 45.4
- if the description states a load ("39 kg", "25kg", "10lb dumbbells"), you MUST include weightKg; omit it only for bodyweight, band, and cardio exercises
- for dumbbell work, use the weight of a single dumbbell as stated
- if the load varies across sets, average it across the working sets — "10 reps x 25 kg, 8 reps x 39 kg, 8 reps x 45 kg" is roughly 36, NOT the 45 kg top set
- sets is HOW MANY sets were performed; reps is the count in ONE set — never the total across sets
- a set list like "10 reps / 8 reps / 10 reps" is sets: 3, reps: 9 (the per-set average), NEVER sets: 3, reps: 28
- for a rep range like 10-12, use the lower number
- for per-side exercises, use the per-side rep count
- for time-based exercises (planks, cardio), omit sets/reps and use durationMinutes instead
- caloriesBurned is the total for that exercise
- confidence: 0.8+ for well-known exercises, lower for unusual ones`;
}

export async function estimateWorkoutFromText(input: {
  text: string;
  weightKg?: number;
}): Promise<WorkoutEstimateResponse> {
  const responseText = await callLlm(
    ESTIMATE_SYSTEM,
    buildEstimatePrompt(input.text, input.weightKg)
  );
  const parsed = WorkoutEstimateResponseSchema.safeParse(extractJson(responseText));
  if (!parsed.success) {
    console.error("Workout estimate failed validation:", parsed.error.issues, responseText);
    throw new Error("The AI returned an unexpected response format. Please try again.");
  }
  return parsed.data;
}

// --- Recommend workout (for the recommendations section) ---

const RECOMMEND_SYSTEM = `You are a personal trainer AI. Given the user's profile, available equipment, and target focus area, design a practical workout plan. Tailor exercises to the equipment available. Include sets, reps, and estimated calories for each exercise. Be specific and actionable.`;

export type RecommendInput = {
  focus: string;
  equipmentPreset?: string;
  equipment?: string[];
  weightKg?: number;
  heightCm?: number;
  age?: number;
  gender?: string;
};

function buildRecommendPrompt(input: RecommendInput) {
  const lines: string[] = [];
  lines.push(`Design a workout focused on: ${input.focus}`);
  lines.push("");

  // Profile
  const stats: string[] = [];
  if (input.weightKg) stats.push(`Weight: ${input.weightKg} kg`);
  if (input.heightCm) stats.push(`Height: ${input.heightCm} cm`);
  if (input.age) stats.push(`Age: ${input.age}`);
  if (input.gender) stats.push(`Gender: ${input.gender}`);
  if (stats.length > 0) {
    lines.push(`User profile: ${stats.join(", ")}`);
  } else {
    lines.push("User profile unknown — design for average adult.");
  }

  // Equipment
  if (input.equipmentPreset === "gym") {
    lines.push("Equipment: Full gym access (barbells, dumbbells, machines, cables, etc.)");
  } else if (input.equipmentPreset === "home") {
    lines.push("Equipment: Home gym (dumbbells, resistance bands, pull-up bar)");
  } else if (input.equipmentPreset === "bodyweight") {
    lines.push("Equipment: Bodyweight only — no equipment");
  } else if (input.equipment && input.equipment.length > 0) {
    lines.push(`Equipment available: ${input.equipment.join(", ")}`);
  } else {
    lines.push("Equipment: Unknown — assume bodyweight exercises only for safety.");
  }

  const weightNote = input.weightKg
    ? `Use ${input.weightKg} kg for calorie calculations (MET method).`
    : "Assume 70 kg for calorie calculations.";
  lines.push(weightNote);

  lines.push("");
  lines.push(`Return ONLY a JSON object:
{
  "exercises": [
    {
      "exerciseName": "Barbell Squat",
      "muscleGroup": "legs",
      "sets": 4,
      "reps": 10,
      "restSeconds": 90,
      "durationMinutes": 8,
      "estimatedCalories": 60,
      "notes": "Focus on depth, keep core tight"
    }
  ],
  "warmup": "5 min light cardio + dynamic stretches",
  "cooldown": "5 min static stretching",
  "totalEstimatedCalories": 350,
  "totalDurationMinutes": 45,
  "notes": ["overall workout notes"]
}

Rules:
- Include 5-8 exercises appropriate for the focus area
- Only use exercises possible with the available equipment
- ALL numeric fields (sets, reps, restSeconds, durationMinutes, calories) must be plain JSON numbers, NEVER strings
- for rep ranges, pick a single number (10, not "8-12")
- for timed exercises (planks, cardio), omit reps and use durationMinutes instead
- estimatedCalories per exercise should use MET method
- Include restSeconds between sets
- durationMinutes is total time for that exercise including rest
- Be realistic and safe`);

  return lines.join("\n");
}

export async function recommendWorkout(input: RecommendInput): Promise<WorkoutRecommendationResponse> {
  const responseText = await callLlm(
    RECOMMEND_SYSTEM,
    buildRecommendPrompt(input)
  );
  const parsed = WorkoutRecommendationResponseSchema.safeParse(extractJson(responseText));
  if (!parsed.success) {
    console.error("Workout recommendation failed validation:", parsed.error.issues, responseText);
    throw new Error("The AI returned an unexpected response format. Please try again.");
  }
  return parsed.data;
}
