import { z } from "zod";
import { getLlmConfig } from "./llm";

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

const SYSTEM_PROMPT = `You are a fitness estimation assistant. Given a workout description, return a JSON object estimating calories burned for each exercise. If the user mentions a muscle group without specific exercises, recommend 3-5 exercises for that group in the "recommendations" array. Use the MET (Metabolic Equivalent of Task) method when possible and factor in the user's weight if provided. Be conservative with calorie estimates.`;

function buildUserPrompt(text: string, weightKg?: number) {
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
  "recommendations": ["exercise suggestion if muscle group mentioned without specific exercises"],
  "notes": ["any overall notes"]
}

Rules:
- durationMinutes, sets, reps are optional — include whichever is relevant
- caloriesBurned is the total for that exercise
- If user mentions a muscle group (e.g. "chest day", "I want to work legs"), include 3-5 exercise recommendations
- confidence: 0.8+ for well-known exercises, lower for unusual ones`;
}

export async function estimateWorkoutFromText(input: {
  text: string;
  weightKg?: number;
}): Promise<WorkoutEstimateResponse> {
  const config = getLlmConfig();
  if (!config.isEnabled) throw new Error("LLM estimation is disabled");

  let responseText: string;

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
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserPrompt(input.text, input.weightKg) }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic API error: ${res.status}`);
    const data = await res.json();
    responseText = data.content?.[0]?.text ?? "";
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
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserPrompt(input.text, input.weightKg) },
        ],
      }),
    });
    if (!res.ok) throw new Error(`LLM API error: ${res.status}`);
    const data = await res.json();
    responseText = data.choices?.[0]?.message?.content ?? "";
  }

  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON found in LLM response");

  const parsed = JSON.parse(jsonMatch[0]);
  return WorkoutEstimateResponseSchema.parse(parsed);
}
