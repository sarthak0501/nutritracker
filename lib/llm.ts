import { z } from "zod";

const EnvSchema = z.object({
  LLM_ENABLED: z.string().default("false"),
  LLM_PROVIDER: z.string().default("openai"),
  LLM_BASE_URL: z.string().default("https://api.openai.com/v1"),
  LLM_API_KEY: z.string().default(""),
  LLM_MODEL: z.string().default("gpt-4o-mini"),
});

export function getLlmConfig() {
  const env = EnvSchema.parse(process.env);
  const isEnabled = env.LLM_ENABLED === "true";
  const isAnthropic =
    env.LLM_PROVIDER === "anthropic" || env.LLM_API_KEY.startsWith("sk-ant-");
  return {
    isEnabled,
    isAnthropic,
    baseUrl: isAnthropic ? "https://api.anthropic.com/v1" : env.LLM_BASE_URL,
    apiKey: env.LLM_API_KEY,
    model: isAnthropic
      ? env.LLM_MODEL === "gpt-4o-mini"
        ? "claude-haiku-4-5-20251001"
        : env.LLM_MODEL
      : env.LLM_MODEL,
  };
}

const EstimatedItemSchema = z.object({
  description: z.string(),
  quantity: z.number().positive(),
  unit: z.string(),
  assumptions: z.array(z.string()),
  nutrients: z.object({
    kcal: z.number().nonnegative(),
    protein_g: z.number().nonnegative(),
    carbs_g: z.number().nonnegative(),
    fat_g: z.number().nonnegative(),
    fiber_g: z.number().nonnegative().optional(),
    sodium_mg: z.number().nonnegative().optional(),
  }),
  confidence: z.number().min(0).max(1),
});

const EstimateResponseSchema = z.object({
  items: z.array(EstimatedItemSchema),
  notes: z.array(z.string()).default([]),
});

export type EstimateResponse = z.infer<typeof EstimateResponseSchema>;

const SYSTEM_PROMPT = `You are a precise nutrition estimation assistant. Given a meal description, return a JSON object estimating the nutrition of each component. Be conservative with confidence when uncertain. Always return valid JSON matching the schema exactly.`;

function buildUserPrompt(text: string) {
  return `Estimate the nutrition for this meal description: "${text}"

Return ONLY a JSON object with this exact structure:
{
  "items": [
    {
      "description": "food item name",
      "quantity": 1,
      "unit": "serving unit (e.g. large, medium, slice, cup)",
      "assumptions": ["assumption 1", "assumption 2"],
      "nutrients": {
        "kcal": 0,
        "protein_g": 0,
        "carbs_g": 0,
        "fat_g": 0,
        "fiber_g": 0,
        "sodium_mg": 0
      },
      "confidence": 0.8
    }
  ],
  "notes": ["any overall notes"]
}

Rules:
- Split into individual food items
- nutrients are for the TOTAL quantity (not per 100g)
- confidence: 0.9+ if well-known, 0.7-0.9 if reasonable assumption, below 0.7 if very uncertain
- Include assumptions about portion sizes`;
}

export async function estimateNutritionFromText(input: { text: string }): Promise<EstimateResponse> {
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
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserPrompt(input.text) }],
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
          { role: "user", content: buildUserPrompt(input.text) },
        ],
      }),
    });
    if (!res.ok) throw new Error(`LLM API error: ${res.status}`);
    const data = await res.json();
    responseText = data.choices?.[0]?.message?.content ?? "";
  }

  // Extract JSON from response (handle code fences)
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON found in LLM response");

  const parsed = JSON.parse(jsonMatch[0]);
  return EstimateResponseSchema.parse(parsed);
}
