import assert from "node:assert/strict";
import { test } from "node:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createNutriTrackerMcpHandler, type McpServices } from "../lib/mcp-server";

import { MCP_SCOPES } from "../lib/oauth-config";

const origin = "https://nutritracker.example";
const endpoint = `${origin}/api/mcp`;
function fixture(overrides: Parameters<typeof createNutriTrackerMcpHandler>[0] = {}) {
  const calls: Array<{ tool: string; userId: string }> = [];
  const service = (tool: string) => async (userId: string) => {
    calls.push({ tool, userId }); return { username: userId, tool };
  };
  const services: McpServices = { account: service("account"), day: service("day"), progress: service("progress"), prepare: service("prepare"), log: service("log"), undo: service("undo") };
  const handle = createNutriTrackerMcpHandler({
    config: () => ({ enabled: true, origin, resource: endpoint }),
    authenticate: async request => {
      const token = request.headers.get("authorization");
      if (!token?.startsWith("Bearer ")) return null;
      const userId = token.slice(7);
      return { userId, connectionId: userId, scopes: userId === "read-only" ? ["nutrition:read"] : userId === "write-only" ? ["nutrition:write"] : userId === "legacy" ? ["nutrition:read", "nutrition:write"] : [...MCP_SCOPES] };
    },
    unauthorized: () => new Response(null, { status: 401, headers: { "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/api/mcp"` } }),
    rateLimit: async () => true, services, additionalService: async (name, userId) => { calls.push({ tool: name, userId }); return { username: userId, tool: name }; }, ...overrides,
  });
  return { handle, calls };
}
function request(method: string, params: unknown = {}, user = "alice", protocol = "2025-11-25") {
  return new Request(endpoint, { method: "POST", headers: {
    "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${user}`, "mcp-protocol-version": protocol,
  }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
}
async function rpc(response: Response) {
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const text = await response.text();
  return JSON.parse(response.headers.get("content-type")?.includes("text/event-stream") ? text.split("\n").find(line => line.startsWith("data: "))!.slice(6) : text);
}

test("authentication is required for all transport methods; cookies do not grant access", async () => {
  const { handle, calls } = fixture();
  for (const method of ["GET", "DELETE", "POST"]) {
    const response = await handle(new Request(endpoint, { method, headers: { cookie: "nt_session=browser-session" } }));
    assert.equal(response.status, 401);
    assert.match(response.headers.get("www-authenticate")!, /resource_metadata=/);
  }
  assert.deepEqual(calls, []);
});

test("disabled endpoint, invalid origins, stateless methods and rate limits fail closed", async () => {
  assert.equal((await fixture({ config: () => ({ enabled: false, origin, resource: endpoint }) }).handle(request("tools/list"))).status, 404);
  const badOrigin = request("tools/list"); badOrigin.headers.set("origin", "https://evil.example");
  assert.equal((await fixture().handle(badOrigin)).status, 403);
  for (const method of ["GET", "DELETE"]) assert.equal((await fixture().handle(new Request(endpoint, { method, headers: { authorization: "Bearer alice" } }))).status, 405);
  const limited = await fixture({ rateLimit: async () => false }).handle(request("tools/list"));
  assert.equal(limited.status, 429); assert.equal(limited.headers.get("retry-after"), "60");
});

test("legacy Claude protocol initializes and exposes the complete account-scoped tool surface", async () => {
  const { handle } = fixture();
  for (const protocol of ["2025-03-26", "2025-06-18", "2025-11-25"]) {
    const init = await rpc(await handle(request("initialize", { protocolVersion: protocol, capabilities: {}, clientInfo: { name: "claude-fixture", version: "1" } }, "alice", protocol)));
    assert.equal(init.result.protocolVersion, protocol);
    assert.match(init.result.instructions, /explicitly asks to log/);
  }
  const result = await rpc(await handle(request("tools/list")));
  assert.equal(result.result.tools.length, 23);
  for (const tool of result.result.tools) {
    assert.ok(tool.name.startsWith("nutritracker_"));
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.equal(tool.inputSchema.properties.userId, undefined);
    assert.ok(tool.outputSchema);
  }
  assert.equal(result.result.tools.find((t: { name: string }) => t.name === "nutritracker_undo_meal").annotations.destructiveHint, true);
});

test("parallel requests bind tools to their own authenticated users and reject injected user IDs", async () => {
  const { handle, calls } = fixture();
  const [alice, bob] = await Promise.all(["alice", "bob"].map(async user => rpc(await handle(request("tools/call", { name: "nutritracker_get_day", arguments: {} }, user)))));
  assert.equal(alice.result.structuredContent.data.username, "alice");
  assert.equal(bob.result.structuredContent.data.username, "bob");
  const bad = await rpc(await handle(request("tools/call", { name: "nutritracker_get_day", arguments: { userId: "bob" } })));
  assert.ok(bad.result?.isError || bad.error);
  assert.equal(calls.length, 2);
});

test("read-only grants cannot estimate, save or undo; estimate quotas leave reading available", async () => {
  const { handle, calls } = fixture();
  for (const [name, args] of [
    ["prepare_meal", { description: "one apple", mealType: "SNACK" }],
    ["log_meal", { preparedMealToken: "token" }], ["undo_meal", { batchId: "batch" }],
  ] as const) {
    const result = await rpc(await handle(request("tools/call", { name: `nutritracker_${name}`, arguments: args }, "read-only")));
    assert.equal(result.result.isError, true);
    assert.match(result.result.content[0].text, /nutrition:write/);
  }
  assert.deepEqual(calls, []);
  for (const [name, args] of [["log_meal", { preparedMealToken: "token" }], ["undo_meal", { batchId: "batch" }]] as const) {
    const result = await rpc(await handle(request("tools/call", { name: `nutritracker_${name}`, arguments: args }, "write-only")));
    assert.equal(result.result.isError, true);
    assert.match(result.result.content[0].text, /nutrition:read/);
  }
  assert.deepEqual(calls, []);
  const limited = fixture({ rateLimit: async key => !key.startsWith("mcp:estimate:") });
  const error = await rpc(await limited.handle(request("tools/call", { name: "nutritracker_prepare_meal", arguments: { description: "apple", mealType: "SNACK" } })));
  assert.equal(error.result.isError, true);
  const read = await rpc(await limited.handle(request("tools/call", { name: "nutritracker_get_day", arguments: {} })));
  assert.equal(read.result.structuredContent.data.username, "alice");
});

test("malformed and oversized JSON are rejected before tool execution", async () => {
  const { handle, calls } = fixture();
  for (const [body, status] of [["{broken", 400], [JSON.stringify({ oversized: "x".repeat(140_000) }), 413]] as const) {
    const response = await handle(new Request(endpoint, { method: "POST", headers: { authorization: "Bearer alice", "content-type": "application/json", accept: "application/json, text/event-stream" }, body }));
    assert.equal(response.status, status);
  }
  assert.deepEqual(calls, []);
});

test("rate-limit failures are redacted and failed cache refresh never changes a committed save receipt", async () => {
  const secretMessage = "database credentials and private query must never appear";
  const broken = fixture({ rateLimit: async key => {
    if (key.startsWith("mcp:estimate:")) throw new Error(secretMessage);
    return true;
  } });
  const result = await rpc(await broken.handle(request("tools/call", { name: "nutritracker_prepare_meal", arguments: { description: "apple", mealType: "SNACK" } })));
  assert.equal(result.result.isError, true);
  assert.ok(!JSON.stringify(result).includes(secretMessage));
  assert.deepEqual(broken.calls, []);
  const cacheFailure = fixture({ afterWrite: () => { throw new Error("cache invalidation failed"); } });
  const saved = await rpc(await cacheFailure.handle(request("tools/call", { name: "nutritracker_log_meal", arguments: { preparedMealToken: "token" } })));
  assert.ok(!saved.result.isError);
  assert.deepEqual(saved.result.structuredContent, { data: { username: "alice", tool: "log" } });
});

test("official MCP client can connect, discover tools and read an account", async () => {
  const { handle } = fixture();
  const client = new Client({ name: "phone-fixture", version: "1" });
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: { headers: { authorization: "Bearer alice" } },
    fetch: async (input, init) => handle(new Request(input, init)),
  });
  try {
    await client.connect(transport);
    assert.equal((await client.listTools()).tools.length, 23);
    const result = await client.callTool({ name: "nutritracker_get_account", arguments: {} });
    assert.deepEqual(result.structuredContent, { data: { username: "alice", tool: "account" } });
  } finally { await client.close(); }
});

const extensionInputs: Record<string, object> = {
  get_buddy_day: {},
  get_workouts: {}, log_workout: { requestId: "a", date: "2026-11-01", completed: true, exercises: [{ exerciseName: "Walk", durationMinutes: 30 }] },
  update_workout: { requestId: "b", entryId: "a", expectedUpdatedAt: "2026-11-01T00:00:00.000Z", changes: { durationMinutes: 40 } },
  delete_workout: { requestId: "c", entryId: "a", expectedUpdatedAt: "2026-11-01T00:00:00.000Z" },
  get_measurements: {}, set_water: { requestId: "d", date: "2026-11-01", glasses: 2, expectedGlasses: 0 },
  set_weight: { requestId: "e", date: "2026-11-01", weightKg: 75, expectedWeightKg: null },
  delete_weight: { requestId: "f", date: "2026-11-01", expectedWeightKg: 75 },
  get_saved_meals: {}, save_meal_preset: { requestId: "g", name: "Lunch", source: { kind: "entries", entryIds: ["a"] } },
  remove_meal_preset: { requestId: "h", id: "a", expectedUpdatedAt: "2026-11-01T00:00:00.000Z" },
  log_existing_meal: { requestId: "i", source: { kind: "saved", id: "a" }, date: "2026-11-01", mealType: "LUNCH" },
  correct_meal_entries: { requestId: "j", entries: [{ action: "remove", entryId: "a", expectedUpdatedAt: "2026-11-01T00:00:00.000Z" }] },
  get_buddy_meals: {}, share_meal: { requestId: "k", source: { kind: "entries", entryIds: ["a"] }, date: "2026-11-01", mealType: "LUNCH", recipientId: "b", confirmed: true },
  respond_shared_meal: { requestId: "l", proposalId: "a", action: "decline" },
};
test("all new tools reject old grants and bind authorized calls to the current account", async () => {
  const { handle, calls } = fixture();
  for (const [name, args] of Object.entries(extensionInputs)) {
    const denied = await rpc(await handle(request("tools/call", { name: `nutritracker_${name}`, arguments: args }, "legacy")));
    assert.equal(denied.result.isError, true, name);
    assert.match(denied.result.content[0].text, /Reconnect NutriTracker/, name);
  }
  assert.deepEqual(calls, []);
  for (const [name, args] of Object.entries(extensionInputs)) {
    const allowed = await rpc(await handle(request("tools/call", { name: `nutritracker_${name}`, arguments: args }, "bob")));
    assert.equal(allowed.result.structuredContent.data.username, "bob", name);
    const rejected = await rpc(await handle(request("tools/call", { name: `nutritracker_${name}`, arguments: { ...args, userId: "alice" } }, "bob")));
    assert.ok(rejected.error || rejected.result.isError, name);
  }
  assert.equal(calls.length, 17);
  const listed = (await rpc(await handle(request("tools/list")))).result.tools;
  for (const name of ["share_meal", "respond_shared_meal"]) assert.equal(listed.find((t: {name: string}) => t.name === `nutritracker_${name}`).annotations.openWorldHint, true);
});
