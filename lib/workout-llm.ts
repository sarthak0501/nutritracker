import { z } from "zod";
import { getLlmConfig } from "./llm";

// --- Workout Estimation (log) ---

const WorkoutItemSchema = z.object({
  exerciseName: z.string(),
  muscleGroup: z.string().optional(),
  durationMinutes: z.number().optional(),
  sets: z.number().optional(),
  reps: z.number().optional(),
  caloriesBurned: z.number().nonnegative(),
  confidence: z.number().min(0).max(1),
  assumptions: z.array(z.string()),
});

const WorkoutEstimateResponseSchema = z.object({
  exercises: z.array(WorkoutItemSchema),
  recommendations: z.array(z.string()).default([]),
  notes: z.array(z.string()).default([]),
});

export type WorkoutEstimateResponse = z.infer<typeof WorkoutEstimateResponseSchema>;

// --- Workout Recommendations ---

const RecommendedExerciseSchema = z.object({
  exerciseName: z.string(),
  muscleGroup: z.string(),
  sets: z.number(),
  reps: z.number(),
  restSeconds: z.number().optional(),
  durationMinutes: z.number().optional(),
  estimatedCalories: z.number().nonnegative(),
  notes: z.string().optional(),
});

const WorkoutRecommendationResponseSchema = z.object({
  exercises: z.array(RecommendedExerciseSchema),
  warmup: z.string().optional(),
  cooldown: z.string().optional(),
  totalEstimatedCalories: z.number().nonnegative(),
  totalDurationMinutes: z.number(),
  notes: z.array(z.string()).default([]),
});

export type RecommendedExercise = z.infer<typeof RecommendedExerciseSchema>;
export type WorkoutRecommendationResponse = z.infer<typeof WorkoutRecommendationResponseSchema>;

// --- Shared LLM call helper ---

async function callLlm(systemPrompt: string, userPrompt: string): Promise<string> {
  const config = getLlmConfig();
  if (!config.isEnabled) throw new Error("LLM estimation is disabled");

  if (config.isAnthropic) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic API error: ${res.status}`);
    const data = await res.json();
    return data.content?.[0]?.text ?? "";
  } else {
    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.2,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });
    if (!res.ok) throw new Error(`LLM API error: ${res.status}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? "";
  }
}

function extractJson(text: string): unknown {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON found in LLM response");
  return JSON.parse(jsonMatch[0]);
}

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
      "caloriesBurned": 150,
      "confidence": 0.8,
      "assumptions": ["assumed moderate intensity"]
    }
  ],
  "recommendations": [],
  "notes": ["any overall notes"]
}

Rules:
- durationMinutes, sets, reps are optional — include whichever is relevant
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
  return WorkoutEstimateResponseSchema.parse(extractJson(responseText));
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
  return WorkoutRecommendationResponseSchema.parse(extractJson(responseText));
}
