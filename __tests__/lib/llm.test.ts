import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getLlmConfig, estimateNutritionFromText } from "@/lib/llm";

const VALID_RESPONSE = {
  items: [
    {
      description: "Chicken breast",
      quantity: 1,
      unit: "serving",
      assumptions: ["average sized breast"],
      nutrients: {
        kcal: 165,
        protein_g: 31,
        carbs_g: 0,
        fat_g: 3.6,
        fiber_g: 0,
        sodium_mg: 74,
      },
      confidence: 0.9,
    },
  ],
  notes: ["Grilled without added fats"],
};

function makeOpenAIResponse(content: string) {
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { content } }],
    }),
  };
}

function makeAnthropicResponse(content: string) {
  return {
    ok: true,
    json: async () => ({
      content: [{ text: content }],
    }),
  };
}

describe("getLlmConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns disabled when LLM_ENABLED is not set", () => {
    delete process.env.LLM_ENABLED;
    expect(getLlmConfig().isEnabled).toBe(false);
  });

  it("returns enabled when LLM_ENABLED=true", () => {
    process.env.LLM_ENABLED = "true";
    expect(getLlmConfig().isEnabled).toBe(true);
  });

  it("detects Anthropic from LLM_PROVIDER=anthropic", () => {
    process.env.LLM_ENABLED = "true";
    process.env.LLM_PROVIDER = "anthropic";
    process.env.LLM_API_KEY = "some-key";
    const config = getLlmConfig();
    expect(config.isAnthropic).toBe(true);
    expect(config.baseUrl).toBe("https://api.anthropic.com/v1");
  });

  it("detects Anthropic from sk-ant- key prefix", () => {
    process.env.LLM_ENABLED = "true";
    process.env.LLM_PROVIDER = "openai";
    process.env.LLM_API_KEY = "sk-ant-api03-test";
    const config = getLlmConfig();
    expect(config.isAnthropic).toBe(true);
  });

  it("defaults to OpenAI when provider is not anthropic", () => {
    process.env.LLM_ENABLED = "true";
    process.env.LLM_PROVIDER = "openai";
    process.env.LLM_API_KEY = "sk-openai-key";
    const config = getLlmConfig();
    expect(config.isAnthropic).toBe(false);
  });

  it("uses default model for openai", () => {
    process.env.LLM_ENABLED = "true";
    process.env.LLM_PROVIDER = "openai";
    delete process.env.LLM_MODEL;
    const config = getLlmConfig();
    expect(config.model).toBe("gpt-4o-mini");
  });

  it("substitutes claude-haiku when Anthropic + default model", () => {
    process.env.LLM_ENABLED = "true";
    process.env.LLM_PROVIDER = "anthropic";
    process.env.LLM_API_KEY = "some-key";
    delete process.env.LLM_MODEL;
    const config = getLlmConfig();
    expect(config.model).toBe("claude-haiku-4-5-20251001");
  });

  it("preserves custom model for Anthropic", () => {
    process.env.LLM_ENABLED = "true";
    process.env.LLM_PROVIDER = "anthropic";
    process.env.LLM_API_KEY = "some-key";
    process.env.LLM_MODEL = "claude-opus-4-6";
    const config = getLlmConfig();
    expect(config.model).toBe("claude-opus-4-6");
  });
});

describe("estimateNutritionFromText", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.LLM_ENABLED = "true";
    process.env.LLM_PROVIDER = "openai";
    process.env.LLM_API_KEY = "test-key";
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
  });

  it("throws when LLM is disabled", async () => {
    process.env.LLM_ENABLED = "false";
    await expect(estimateNutritionFromText({ text: "chicken" })).rejects.toThrow("LLM estimation is disabled");
  });

  it("calls OpenAI endpoint and parses valid response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeOpenAIResponse(JSON.stringify(VALID_RESPONSE)));
    vi.stubGlobal("fetch", fetchMock);

    const result = await estimateNutritionFromText({ text: "grilled chicken breast" });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain("/chat/completions");
    expect(JSON.parse(opts.body).messages[1].content).toContain("grilled chicken breast");

    expect(result.items).toHaveLength(1);
    expect(result.items[0].description).toBe("Chicken breast");
    expect(result.items[0].nutrients.kcal).toBe(165);
  });

  it("calls Anthropic endpoint when configured", async () => {
    process.env.LLM_PROVIDER = "anthropic";
    process.env.LLM_API_KEY = "test-key";
    delete process.env.LLM_MODEL;

    const fetchMock = vi.fn().mockResolvedValue(makeAnthropicResponse(JSON.stringify(VALID_RESPONSE)));
    vi.stubGlobal("fetch", fetchMock);

    const result = await estimateNutritionFromText({ text: "salad" });

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(opts.headers["x-api-key"]).toBe("test-key");
    expect(result.items).toHaveLength(1);
  });

  it("extracts JSON from markdown code fences", async () => {
    const wrapped = "```json\n" + JSON.stringify(VALID_RESPONSE) + "\n```";
    const fetchMock = vi.fn().mockResolvedValue(makeOpenAIResponse(wrapped));
    vi.stubGlobal("fetch", fetchMock);

    const result = await estimateNutritionFromText({ text: "apple" });
    expect(result.items[0].nutrients.kcal).toBe(165);
  });

  it("throws when API returns non-ok status", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    vi.stubGlobal("fetch", fetchMock);

    await expect(estimateNutritionFromText({ text: "banana" })).rejects.toThrow("LLM API error: 401");
  });

  it("throws when response contains no JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeOpenAIResponse("No JSON here, sorry!"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(estimateNutritionFromText({ text: "pasta" })).rejects.toThrow("No JSON found in LLM response");
  });

  it("throws when response JSON fails schema validation", async () => {
    const badPayload = { items: [{ description: "food", quantity: -1 }] };
    const fetchMock = vi.fn().mockResolvedValue(makeOpenAIResponse(JSON.stringify(badPayload)));
    vi.stubGlobal("fetch", fetchMock);

    await expect(estimateNutritionFromText({ text: "food" })).rejects.toThrow();
  });

  it("defaults notes to empty array when not provided", async () => {
    const withoutNotes = { items: VALID_RESPONSE.items };
    const fetchMock = vi.fn().mockResolvedValue(makeOpenAIResponse(JSON.stringify(withoutNotes)));
    vi.stubGlobal("fetch", fetchMock);

    const result = await estimateNutritionFromText({ text: "chicken" });
    expect(result.notes).toEqual([]);
  });
});
