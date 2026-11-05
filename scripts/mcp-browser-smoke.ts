import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium, type BrowserContext } from "playwright";
import { prisma } from "../lib/db";
import { prepareMcpMeal } from "../lib/mcp-nutrition";

const database = new URL(process.env.DATABASE_URL!);
assert.equal(database.hostname, "localhost"); assert.equal(database.username, "nt_fixture");
assert.equal(database.pathname, "/nutritracker_test");
assert.match(database.searchParams.get("host")!, /^\/tmp\/nt-fixture-[a-f0-9]{12}\/socket$/);
const base = "http://localhost:3091";
assert.equal(process.env.MCP_PUBLIC_URL, base);
const fixture = JSON.parse(readFileSync(".test-state/ui-fixture.json", "utf8"));
assert.equal(fixture.fixtureOnly, true);
const callback = "https://claude.ai/api/mcp/auth_callback";
const resource = `${base}/api/mcp`;
const browser = await chromium.launch({ headless: true });
const errors: string[] = [];
const contexts: BrowserContext[] = [];
const steps: string[] = [];
const pass = (label: string) => { steps.push(label); console.log(`PASS ${label}`); };
async function rpc(token: string, name: string, args: object = {}) {
  const response = await fetch(resource, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-11-25" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: `nutritracker_${name}`, arguments: args } }) });
  if (response.status !== 200) return { status: response.status };
  const text = await response.text();
  const payload = JSON.parse(response.headers.get("content-type")?.includes("text/event-stream") ? text.split("\n").find(line => line.startsWith("data: "))!.slice(6) : text);
  assert.ok(!payload.error, JSON.stringify(payload.error));
  return { status: response.status, ...payload.result };
}
async function connect(user: { id: string; username: string }, clientId: string) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  contexts.push(context);
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  let returned: URL | undefined;
  await page.route(`${base}/oauth/consent`, async route => {
    // Execute the real consent POST, but stop its external redirect at the test boundary.
    const response = await route.fetch({ maxRedirects: 0 });
    assert.equal(response.status(), 303);
    returned = new URL(response.headers().location);
    assert.equal(`${returned.origin}${returned.pathname}`, callback);
    await route.fulfill({ status: 200, contentType: "text/html", body: "<p>Fixture callback received.</p>" });
  });
  const verifier = randomBytes(48).toString("base64url");
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: callback, response_type: "code", resource, scope: "nutrition:read nutrition:write", code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", state: user.username });
  await page.goto(`${base}/oauth/authorize?${params}`);
  await page.getByLabel("Username", { exact: true }).fill(user.username);
  await page.getByLabel("Password", { exact: true }).fill(fixture.password);
  await page.getByRole("button", { name: "Get started", exact: true }).click();
  await page.getByRole("heading", { name: "Connect Claude", exact: true }).waitFor();
  assert.match(await page.locator("body").innerText(), new RegExp(`Signed in as ${user.username}`));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: `.test-state/mcp-browser/${user.username}-consent.png`, fullPage: true });
  await page.getByRole("button", { name: "Allow connection", exact: true }).click();
  await page.getByText("Fixture callback received.", { exact: true }).waitFor();
  assert.equal(returned!.searchParams.get("state"), user.username);
  const tokenResponse = await fetch(`${base}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientId, redirect_uri: callback, resource, grant_type: "authorization_code", code: returned!.searchParams.get("code")!, code_verifier: verifier }) });
  assert.equal(tokenResponse.status, 200);
  const tokens = await tokenResponse.json();
  const identity = await rpc(tokens.access_token, "get_account");
  assert.equal(identity.structuredContent.data.username, user.username);
  pass(`mobile login, consent, OAuth exchange and MCP identity for ${user.username}`);
  return { page, tokens };
}

mkdirSync(".test-state/mcp-browser", { recursive: true, mode: 0o700 });
try {
  const challenge = await fetch(resource); assert.equal(challenge.status, 401);
  assert.match(challenge.headers.get("www-authenticate")!, /resource_metadata/);
  for (const path of ["/.well-known/oauth-protected-resource/api/mcp", "/.well-known/oauth-authorization-server"]) {
    const metadata = await fetch(`${base}${path}`); assert.equal(metadata.status, 200);
    assert.match(await metadata.text(), /nutrition:read/);
  }
  const registered = await fetch(`${base}/oauth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: [callback], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"] }) });
  assert.equal(registered.status, 201);
  const client = await registered.json();
  pass("public discovery, OAuth challenge and dynamic client registration");
  const alex = await connect(fixture.alex, client.client_id);
  const jamie = await connect(fixture.jamie, client.client_id);
  const prepared = await prepareMcpMeal(fixture.alex.id, { description: "one fixture apple", date: fixture.date, mealType: "SNACK" }, { estimate: async () => ({ items: [{ description: "Fixture apple", quantity: 100, unit: "g", nutrients: { kcal: 52, protein_g: 0.3, carbs_g: 14, fat_g: 0.2, fiber_g: 2.4 }, assumptions: ["Synthetic test estimate"], confidence: 1 }], notes: [] }) });
  const foreign = await rpc(jamie.tokens.access_token, "log_meal", { preparedMealToken: prepared.preparedMealToken });
  assert.equal(foreign.isError, true);
  const args = { preparedMealToken: prepared.preparedMealToken };
  const first = await rpc(alex.tokens.access_token, "log_meal", args);
  assert.ok(!first.isError, JSON.stringify(first));
  const retry = await rpc(alex.tokens.access_token, "log_meal", args);
  assert.equal(retry.structuredContent.data.batchId, first.structuredContent.data.batchId);
  assert.equal(await prisma.logEntry.count({ where: { batchId: first.structuredContent.data.batchId } }), 1);
  const otherDay = await rpc(jamie.tokens.access_token, "get_day", { date: fixture.date });
  assert.equal(otherDay.structuredContent.data.entryCount, 0);
  const week = await rpc(alex.tokens.access_token, "get_progress", { endDate: fixture.date, days: 7 });
  assert.ok(!week.isError);
  pass("account isolation, meal save/retry and progress through the real HTTP route");
  const undone = await rpc(alex.tokens.access_token, "undo_meal", { batchId: first.structuredContent.data.batchId });
  assert.ok(!undone.isError);
  await rpc(alex.tokens.access_token, "log_meal", args);
  assert.equal(await prisma.logEntry.count({ where: { batchId: first.structuredContent.data.batchId } }), 0);
  pass("Undo and delayed save retry cannot restore the removed meal");
  const refreshed = await fetch(`${base}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: client.client_id, resource, grant_type: "refresh_token", refresh_token: alex.tokens.refresh_token }) });
  assert.equal(refreshed.status, 200);
  const fresh = await refreshed.json();
  await alex.page.goto(`${base}/connections`);
  await alex.page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await alex.page.getByText(/No assistants are connected/).waitFor();
  assert.equal((await rpc(fresh.access_token, "get_account")).status, 401);
  assert.equal((await rpc(alex.tokens.access_token, "get_account")).status, 401);
  assert.equal((await rpc(jamie.tokens.access_token, "get_account")).structuredContent.data.username, fixture.jamie.username);
  pass("refresh and account-specific disconnect through the website");
  assert.deepEqual(errors, []);
  writeFileSync(".test-state/mcp-browser/report.json", JSON.stringify({ fixtureOnly: true, steps, pageErrors: errors }, null, 2), { mode: 0o600 });
} finally {
  await Promise.all(contexts.map(context => context.close()));
  await browser.close(); await prisma.$disconnect();
}
