import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { estimateWorkoutFromText, recommendWorkout } from "@/lib/workout-llm";

const VALID_ESTIMATE = {
  exercises: [
    {
      exerciseName: "Running",
      muscleGroup: "cardio",
      durationMinutes: 30,
      caloriesBurned: 300,
      confidence: 0.85,
      assumptions: ["moderate pace"],
    },
  ],
  recommendations: [],
  notes: [],
};

const VALID_RECOMMENDATION = {
  exercises: [
    {
      exerciseName: "Barbell Squat",
      muscleGroup: "legs",
      sets: 4,
      reps: 10,
      restSeconds: 90,
      durationMinutes: 8,
      estimatedCalories: 60,
      notes: "Keep core tight",
    },
  ],
  warmup: "5 min light cardio",
  cooldown: "5 min stretching",
  totalEstimatedCalories: 350,
  totalDurationMinutes: 45,
  notes: [],
};

function makeOpenAIResponse(content: string) {
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content } }] }),
  };
}

function makeAnthropicResponse(content: string) {
  return {
    ok: true,
    json: async () => ({ content: [{ text: content }] }),
  };
}

describe("estimateWorkoutFromText", () => {
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
    await expect(estimateWorkoutFromText({ text: "ran 5km" })).rejects.toThrow("LLM estimation is disabled");
  });

  it("calls OpenAI endpoint and returns parsed exercises", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeOpenAIResponse(JSON.stringify(VALID_ESTIMATE)));
    vi.stubGlobal("fetch", fetchMock);

    const result = await estimateWorkoutFromText({ text: "ran 5km at easy pace" });

    expect(result.exercises).toHaveLength(1);
    expect(result.exercises[0].exerciseName).toBe("Running");
    expect(result.exercises[0].caloriesBurned).toBe(300);
  });

  it("includes user weight in prompt", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeOpenAIResponse(JSON.stringify(VALID_ESTIMATE)));
    vi.stubGlobal("fetch", fetchMock);

    await estimateWorkoutFromText({ text: "bench press", weightKg: 80 });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const userMessage = body.messages.find((m: { role: string }) => m.role === "user")?.content ?? "";
    expect(userMessage).toContain("80 kg");
  });

  it("notes unknown weight assumption when weightKg not provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeOpenAIResponse(JSON.stringify(VALID_ESTIMATE)));
    vi.stubGlobal("fetch", fetchMock);

    await estimateWorkoutFromText({ text: "push-ups" });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const userMessage = body.messages.find((m: { role: string }) => m.role === "user")?.content ?? "";
    expect(userMessage).toContain("70 kg");
  });

  it("calls Anthropic endpoint when configured", async () => {
    process.env.LLM_PROVIDER = "anthropic";
    process.env.LLM_API_KEY = "sk-ant-test";

    const fetchMock = vi.fn().mockResolvedValue(makeAnthropicResponse(JSON.stringify(VALID_ESTIMATE)));
    vi.stubGlobal("fetch", fetchMock);

    await estimateWorkoutFromText({ text: "yoga" });

    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
  });

  it("throws on API error", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 429 });
    vi.stubGlobal("fetch", fetchMock);

    await expect(estimateWorkoutFromText({ text: "swimming" })).rejects.toThrow("LLM API error: 429");
  });

  it("throws when no JSON in response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeOpenAIResponse("Sorry, I cannot help."));
    vi.stubGlobal("fetch", fetchMock);

    await expect(estimateWorkoutFromText({ text: "cycling" })).rejects.toThrow("No JSON found in LLM response");
  });

  it("defaults recommendations and notes to empty arrays", async () => {
    const minimal = { exercises: [VALID_ESTIMATE.exercises[0]] };
    const fetchMock = vi.fn().mockResolvedValue(makeOpenAIResponse(JSON.stringify(minimal)));
    vi.stubGlobal("fetch", fetchMock);

    const result = await estimateWorkoutFromText({ text: "run" });
    expect(result.recommendations).toEqual([]);
    expect(result.notes).toEqual([]);
  });
});

describe("recommendWorkout", () => {
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

  it("throws when LLM disabled", async () => {
    process.env.LLM_ENABLED = "false";
    await expect(recommendWorkout({ focus: "legs" })).rejects.toThrow("LLM estimation is disabled");
  });

  it("returns parsed recommendation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeOpenAIResponse(JSON.stringify(VALID_RECOMMENDATION)));
    vi.stubGlobal("fetch", fetchMock);

    const result = await recommendWorkout({ focus: "legs" });
    expect(result.exercises).toHaveLength(1);
    expect(result.totalEstimatedCalories).toBe(350);
    expect(result.totalDurationMinutes).toBe(45);
  });

  it("includes equipment preset in prompt", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeOpenAIResponse(JSON.stringify(VALID_RECOMMENDATION)));
    vi.stubGlobal("fetch", fetchMock);

    await recommendWorkout({ focus: "chest", equipmentPreset: "gym" });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const userMessage = body.messages.find((m: { role: string }) => m.role === "user")?.content ?? "";
    expect(userMessage).toContain("Full gym");
  });

  it("includes bodyweight note when no equipment provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeOpenAIResponse(JSON.stringify(VALID_RECOMMENDATION)));
    vi.stubGlobal("fetch", fetchMock);

    await recommendWorkout({ focus: "core" });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const userMessage = body.messages.find((m: { role: string }) => m.role === "user")?.content ?? "";
    expect(userMessage).toContain("bodyweight");
  });

  it("includes user profile stats in prompt", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeOpenAIResponse(JSON.stringify(VALID_RECOMMENDATION)));
    vi.stubGlobal("fetch", fetchMock);

    await recommendWorkout({ focus: "back", weightKg: 75, heightCm: 180, age: 30, gender: "male" });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const userMessage = body.messages.find((m: { role: string }) => m.role === "user")?.content ?? "";
    expect(userMessage).toContain("75 kg");
    expect(userMessage).toContain("180 cm");
    expect(userMessage).toContain("30");
    expect(userMessage).toContain("male");
  });

  it("mentions home equipment preset", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeOpenAIResponse(JSON.stringify(VALID_RECOMMENDATION)));
    vi.stubGlobal("fetch", fetchMock);

    await recommendWorkout({ focus: "arms", equipmentPreset: "home" });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const userMessage = body.messages.find((m: { role: string }) => m.role === "user")?.content ?? "";
    expect(userMessage).toContain("Home gym");
  });

  it("lists custom equipment in prompt", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeOpenAIResponse(JSON.stringify(VALID_RECOMMENDATION)));
    vi.stubGlobal("fetch", fetchMock);

    await recommendWorkout({ focus: "shoulders", equipment: ["dumbbells", "barbell"] });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const userMessage = body.messages.find((m: { role: string }) => m.role === "user")?.content ?? "";
    expect(userMessage).toContain("dumbbells");
    expect(userMessage).toContain("barbell");
  });
});
