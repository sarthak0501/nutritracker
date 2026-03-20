import { z } from "zod";
import { callLlm, extractJson } from "./llm-client";

const WeeklySummarySchema = z.object({
  summary: z.string(),
  highlights: z.array(z.string()),
  suggestions: z.array(z.string()),
  overallGrade: z.enum(["A", "B", "C", "D", "F"]),
});

export type WeeklySummaryResponse = z.infer<typeof WeeklySummarySchema>;

const SYSTEM = `You are a friendly nutrition coach. Given a user's weekly data and goals, write a brief, encouraging performance summary. Be specific about what went well and what to improve. Return ONLY valid JSON.`;

export async function generateWeeklySummary(input: {
  days: { date: string; kcal: number; protein: number; carbs: number; fat: number; fiber: number }[];
  targets: { kcal: number; protein: number; carbs: number; fat: number; fiber: number | null };
  workoutDays: number;
  totalBurned: number;
  weightChange: number | null;
}): Promise<WeeklySummaryResponse> {
  const daysStr = input.days
    .map((d) => `${d.date}: ${d.kcal}cal, ${d.protein}P, ${d.carbs}C, ${d.fat}F, ${d.fiber}fiber`)
    .join("\n");

  const prompt = `Here's my week of nutrition data:

${daysStr}

My daily targets: ${input.targets.kcal}cal, ${input.targets.protein}g protein, ${input.targets.carbs}g carbs, ${input.targets.fat}g fat${input.targets.fiber ? `, ${input.targets.fiber}g fiber` : ""}

Workouts: ${input.workoutDays} days, ${input.totalBurned} total calories burned
${input.weightChange !== null ? `Weight change: ${input.weightChange > 0 ? "+" : ""}${input.weightChange}kg` : ""}

Return ONLY a JSON object:
{
  "summary": "2-3 sentence encouraging summary paragraph",
  "highlights": ["highlight 1", "highlight 2", "highlight 3"],
  "suggestions": ["actionable suggestion 1", "actionable suggestion 2"],
  "overallGrade": "A"
}

Rules:
- overallGrade: A = hit most targets, B = decent, C = needs work, D/F = far off
- Be specific with numbers in highlights
- Keep suggestions actionable and simple`;

  const text = await callLlm(SYSTEM, prompt);
  return WeeklySummarySchema.parse(extractJson(text));
}
