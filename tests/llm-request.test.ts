import assert from "node:assert/strict";
import { test } from "node:test";
import { estimateNutritionFromText } from "../lib/llm";

test("both text estimation providers use a bounded request and parse their response without live API calls", async (t) => {
  const names = ["LLM_ENABLED", "LLM_PROVIDER", "LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL"] as const;
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const response = { items: [{ description: "Egg", quantity: 50, unit: "g", assumptions: [],
    nutrients: { kcal: 70, protein_g: 6, carbs_g: 0, fat_g: 5 }, confidence: 0.8 }], notes: [] };
  const controller = new AbortController();
  let timeoutCalls = 0;
  let requests = 0;
  t.mock.method(AbortSignal, "timeout", (milliseconds: number) => {
    assert.equal(milliseconds, 45_000);
    timeoutCalls++;
    return controller.signal;
  });
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
    requests++;
    assert.equal(init?.signal, controller.signal);
    assert.equal(init?.method, "POST");
    const anthropic = String(url).includes("anthropic.com");
    return Response.json(anthropic
      ? { content: [{ type: "text", text: JSON.stringify(response) }] }
      : { choices: [{ message: { content: JSON.stringify(response) } }] });
  });
  try {
    process.env.LLM_ENABLED = "true";
    process.env.LLM_BASE_URL = "https://fixture.invalid/v1";
    process.env.LLM_API_KEY = "fixture-only-no-real-key";
    process.env.LLM_MODEL = "fixture-model";
    for (const provider of ["openai", "anthropic"]) {
      process.env.LLM_PROVIDER = provider;
      assert.deepEqual(await estimateNutritionFromText({ text: "One egg" }), response);
    }
    assert.equal(requests, 2);
    assert.equal(timeoutCalls, 2);
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});
