import { z } from "zod";
import { callLlm, extractJson } from "./llm-client";

const SuggestionSchema = z.object({
  suggestions: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      estimatedNutrients: z.object({
        kcal: z.number(),
        protein_g: z.number(),
        carbs_g: z.number(),
        fat_g: z.number(),
      }),
      ingredients: z.array(z.string()),
    })
  ),
});

export type MealSuggestionResponse = z.infer<typeof SuggestionSchema>;

const SYSTEM = `You are a practical nutrition advisor. Given the user's remaining macro targets for the day, suggest 3 meal ideas that fit well within those targets. Prioritize simple, everyday meals. Return ONLY valid JSON.`;

export async function suggestMeals(input: {
  remainingKcal: number;
  remainingProtein: number;
  remainingCarbs: number;
  remainingFat: number;
  mealSlot: string;
  allergies?: string[];
  dietaryRestrictions?: string[];
  healthConditions?: string[];
}): Promise<MealSuggestionResponse> {
  const constraints: string[] = [];

  if (input.allergies && input.allergies.length > 0) {
    constraints.push(`Allergies (must avoid): ${input.allergies.join(", ")}`);
  }
  if (input.dietaryRestrictions && input.dietaryRestrictions.length > 0) {
    constraints.push(`Dietary restrictions: ${input.dietaryRestrictions.join(", ")}`);
  }
  if (input.healthConditions && input.healthConditions.length > 0) {
    constraints.push(`Health conditions (tailor suggestions accordingly): ${input.healthConditions.join(", ")}`);
  }

  const constraintsSection = constraints.length > 0
    ? `\nUser health profile:\n${constraints.map(c => `- ${c}`).join("\n")}\n`
    : "";

  const prompt = `I need ${input.mealSlot} ideas. My remaining targets for today:
- ${Math.round(input.remainingKcal)} kcal
- ${Math.round(input.remainingProtein)}g protein
- ${Math.round(input.remainingCarbs)}g carbs
- ${Math.round(input.remainingFat)}g fat
${constraintsSection}
Return ONLY a JSON object:
{
  "suggestions": [
    {
      "name": "meal name",
      "description": "one sentence description",
      "estimatedNutrients": { "kcal": 0, "protein_g": 0, "carbs_g": 0, "fat_g": 0 },
      "ingredients": ["ingredient 1", "ingredient 2"]
    }
  ]
}

Rules:
- Suggest exactly 3 meals that each use roughly 1/3 to 1/2 of the remaining budget
- Keep meals practical and easy to prepare
- Include a high-protein option
- Strictly respect all allergies and dietary restrictions`;

  const text = await callLlm(SYSTEM, prompt);
  return SuggestionSchema.parse(extractJson(text));
}
