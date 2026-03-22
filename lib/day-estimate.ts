import { z } from "zod";
import { getLlmConfig } from "./llm";

// --- Zod schemas ---

const DayItemSchema = z.object({
  description: z.string(),
  quantity: z.number().positive(),
  unit: z.string(),
  nutrients: z.object({
    kcal: z.number().nonnegative(),
    protein_g: z.number().nonnegative(),
    carbs_g: z.number().nonnegative(),
    fat_g: z.number().nonnegative(),
    fiber_g: z.number().nonnegative().optional(),
  }),
  confidence: z.number().min(0).max(1),
  assumptions: z.array(z.string()),
});

const DayMealSchema = z.object({
  mealType: z.enum(["BREAKFAST", "LUNCH", "DINNER", "SNACK", "CUSTOM"]),
  mealName: z.string().nullable(),
  detectedFrom: z.string(),
  items: z.array(DayItemSchema),
});

const DayEstimateSchema = z.object({
  meals: z.array(DayMealSchema),
  unparsed: z.array(z.string()).default([]),
  notes: z.string().default(""),
});

export type DayEstimateResponse = z.infer<typeof DayEstimateSchema>;
export type DayMeal = z.infer<typeof DayMealSchema>;
export type DayItem = z.infer<typeof DayItemSchema>;

// --- LLM prompt ---

const SYSTEM = `You are a nutrition parser. The user will describe everything they ate today in a single message.
Your job is to group the foods into meal types and estimate nutrition for each item.

Meal type rules:
- BREAKFAST: morning foods, explicit "breakfast" label, chai/coffee with morning context
- LUNCH: midday foods, explicit "lunch" label, 12pm–3pm context
- DINNER: evening/night foods, explicit "dinner" label, "dal rice at night", "late dinner"
- SNACK: between-meal items, "after gym", "protein shake", "quick bite", "afternoon snack"
- CUSTOM: anything that truly doesn't fit the above

Detection priority:
1. Explicit labels ("Breakfast:", "Lunch -", "for dinner")
2. Time phrases ("in the morning", "at noon", "after gym", "in the evening", "late night")
3. Food-type heuristics (oats/eggs → likely breakfast, dal/rice → likely dinner)
4. If still unsure → assign SNACK, set confidence < 0.6

Nutrition rules:
- Estimate nutrients for the actual quantity described, not per 100g
- Convert all quantities to grams. Examples: "2 eggs" → 100g, "1 cup rice" → 185g cooked, "1 roti" → 40g
- Make reasonable assumptions for restaurant food (Chipotle burrito bowl ≈ 800 kcal)
- Always populate assumptions[] to explain your reasoning

Return ONLY valid JSON.`;

function buildPrompt(text: string): string {
  return `Parse this full-day food description into grouped meals with nutrition estimates:

"${text}"

Return ONLY a JSON object:
{
  "meals": [
    {
      "mealType": "BREAKFAST" | "LUNCH" | "DINNER" | "SNACK" | "CUSTOM",
      "mealName": "optional name like 'chicken burrito bowl'" or null,
      "detectedFrom": "how you determined the meal type, e.g. 'explicit label', 'context: morning', 'food heuristic'",
      "items": [
        {
          "description": "food item name",
          "quantity": 100,
          "unit": "g",
          "nutrients": { "kcal": 0, "protein_g": 0, "carbs_g": 0, "fat_g": 0, "fiber_g": 0 },
          "confidence": 0.85,
          "assumptions": ["assumed 2 large eggs ~100g total"]
        }
      ]
    }
  ],
  "unparsed": ["items that could not be assigned to any meal"],
  "notes": "brief summary of what was parsed"
}

Rules:
- Group items by detected meal type
- nutrients are for the TOTAL quantity of that item (not per 100g)
- quantity must always be in grams
- confidence: 0.9+ if well-known, 0.7-0.9 if reasonable guess, <0.7 if uncertain
- If unsure about meal type, default to SNACK with low confidence
- Do NOT merge different foods into one item — keep them separate`;
}

// --- Parser function ---

export async function estimateDayFromText(text: string): Promise<DayEstimateResponse> {
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
        max_tokens: 4096,
        system: SYSTEM,
        messages: [{ role: "user", content: buildPrompt(text) }],
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
          { role: "system", content: SYSTEM },
          { role: "user", content: buildPrompt(text) },
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
  return DayEstimateSchema.parse(parsed);
}
