import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { chromium, webkit, type BrowserContext } from "playwright";
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
const callback = "http://127.0.0.1:3092/callback";
assert.ok(process.env.MCP_ALLOWED_REDIRECT_URIS?.split(",").includes(callback), "Configure the local fixture callback in both the app and smoke-test environments.");
const resource = `${base}/api/mcp`;
const browserName = process.env.MCP_TEST_BROWSER ?? "chromium";
assert.ok(browserName === "chromium" || browserName === "webkit");
const browser = await (browserName === "webkit" ? webkit : chromium).launch({ headless: true });
const callbackRequests = new Map<string, { url: URL; referrer: string | undefined }>();
const callbackServer = createServer((request, response) => {
  const url = new URL(request.url!, callback);
  if (url.pathname !== "/callback") { response.writeHead(404).end(); return; }
  callbackRequests.set(url.searchParams.get("state")!, { url, referrer: request.headers.referer });
  response.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" });
  response.end("<p>Fixture callback received.</p>");
});
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
async function connect(user: { id: string; username: string }, clientId: string, reloadConsent: boolean, expanded = true) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  contexts.push(context);
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  const verifier = randomBytes(48).toString("base64url");
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: callback, response_type: "code", resource, scope: "nutrition:read nutrition:write", code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", state: user.username });
  await page.goto(`${base}/oauth/authorize?${params}`);
  await page.getByLabel("Username", { exact: true }).fill(user.username);
  await page.getByLabel("Password", { exact: true }).fill(fixture.password);
  await page.getByRole("button", { name: "Get started", exact: true }).click();
  await page.getByRole("heading", { name: "Connect Configured assistant", exact: true }).waitFor();
  if (reloadConsent) {
    // A full document load applies the consent page's response policy. A Next
    // client transition from login can inherit the login document's policy.
    const document = await page.reload();
    assert.equal(document!.headers()["referrer-policy"], "strict-origin");
  }
  assert.match(await page.locator("body").innerText(), new RegExp(`Signed in as ${user.username}`));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  for (const group of ["workouts", "wellness", "meals", "sharing"]) {
    const checkbox = page.locator(`input[name="allow_${group}"]`);
    assert.equal(await checkbox.isChecked(), false);
    if (expanded) await checkbox.check();
  }
  await page.screenshot({ path: `.test-state/mcp-browser/${browserName}-${user.username}-consent.png`, fullPage: true });
  const submitted = page.waitForRequest(request => request.url() === `${base}/oauth/consent` && request.method() === "POST");
  await page.getByRole("button", { name: "Allow connection", exact: true }).click();
  const nativePost = await submitted;
  assert.equal((await nativePost.allHeaders()).origin, base, "Native consent POST must preserve the real Origin; do not replay it with route.fetch.");
  await page.getByText("Fixture callback received.", { exact: true }).waitFor();
  const consentResponse = await nativePost.response();
  if (consentResponse) {
    assert.equal(consentResponse.status(), 303);
    assert.equal(consentResponse.headers()["referrer-policy"], "no-referrer");
  } else {
    // WebKit completes this cross-site redirect but hides its intermediate
    // response. Require its exact observed signal plus the callback and token
    // exchange below; never replay the POST through an API client.
    assert.equal(browserName, "webkit");
    assert.equal(nativePost.failure()?.errorText, "Frame load interrupted");
  }
  const returned = callbackRequests.get(user.username)!;
  assert.equal(returned.url.searchParams.get("state"), user.username);
  assert.ok(returned.url.searchParams.get("code"));
  assert.equal(returned.referrer, undefined, "The external OAuth callback must not receive the authorization URL as a referrer.");
  const tokenResponse = await fetch(`${base}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientId, redirect_uri: callback, resource, grant_type: "authorization_code", code: returned.url.searchParams.get("code")!, code_verifier: verifier }) });
  assert.equal(tokenResponse.status, 200);
  const tokens = await tokenResponse.json();
  const identity = await rpc(tokens.access_token, "get_account");
  assert.equal(identity.structuredContent.data.username, user.username);
  pass(`${browserName}: ${reloadConsent ? "reloaded" : "fresh-login"} native consent POST, private callback, OAuth exchange and identity for ${user.username}`);
  return { page, tokens };
}

mkdirSync(".test-state/mcp-browser", { recursive: true, mode: 0o700 });
try {
  await new Promise<void>((resolve, reject) => {
    callbackServer.once("error", reject);
    callbackServer.listen(3092, "127.0.0.1", resolve);
  });
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
  const legacy = await connect(fixture.alex, client.client_id, true, false);
  assert.equal((await rpc(legacy.tokens.access_token, "get_workouts")).isError, true);
  const revoked = await fetch(`${base}/oauth/revoke`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: client.client_id, token: legacy.tokens.refresh_token }) });
  assert.equal(revoked.status, 200);
  const alex = await connect(fixture.alex, client.client_id, true);
  assert.match(alex.tokens.scope, /workouts:write/);
  const jamie = await connect(fixture.jamie, client.client_id, false);
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
  function data(result: Awaited<ReturnType<typeof rpc>>) {
    assert.ok(!result.isError, JSON.stringify(result));
    return result.structuredContent.data;
  }
  const exerciseInput = { requestId: "browser-workout", date: fixture.date, completed: true, exercises: [{ exerciseName: "Fixture bench press", sets: 3, reps: 10, weightKg: 40 }] };
  const workout = data(await rpc(alex.tokens.access_token, "log_workout", exerciseInput)).entries[0];
  assert.equal(data(await rpc(alex.tokens.access_token, "log_workout", exerciseInput)).entries[0].id, workout.id);
  assert.equal(data(await rpc(jamie.tokens.access_token, "get_workouts")).entries.length, 0);
  const corrected = data(await rpc(alex.tokens.access_token, "update_workout", { requestId: "browser-correct-workout", entryId: workout.id, expectedUpdatedAt: workout.updatedAt, changes: { weightKg: 35 } })).entry;
  assert.equal(corrected.weightKg, 35);
  await alex.page.goto(`${base}/workouts`);
  await alex.page.getByText("Fixture bench press", { exact: true }).waitFor();
  assert.match(await alex.page.locator("body").innerText(), /Calories not recorded/);
  data(await rpc(alex.tokens.access_token, "delete_workout", { requestId: "browser-delete-workout", entryId: corrected.id, expectedUpdatedAt: corrected.updatedAt }));
  const measurements = data(await rpc(alex.tokens.access_token, "get_measurements", { endDate: fixture.date, days: 1 }));
  data(await rpc(alex.tokens.access_token, "set_water", { requestId: "browser-water", date: fixture.date, glasses: 4, expectedGlasses: measurements.water[0]?.glasses ?? 0 }));
  data(await rpc(alex.tokens.access_token, "set_weight", { requestId: "browser-weight", date: fixture.date, weightKg: 75, expectedWeightKg: measurements.weight[0]?.weightKg ?? null }));
  const measured = data(await rpc(alex.tokens.access_token, "get_measurements", { endDate: fixture.date, days: 1 }));
  assert.equal(measured.water[0].glasses, 4); assert.equal(measured.weight[0].weightKg, 75);
  pass("expanded consent, workout log/correct/delete, website display and water/weight round trip");
  const day = data(await rpc(alex.tokens.access_token, "get_day", { date: fixture.date }));
  const food = day.entries.find((entry: { batchId: string }) => entry.batchId === first.structuredContent.data.batchId);
  const preset = data(await rpc(alex.tokens.access_token, "save_meal_preset", { requestId: "browser-preset", name: "Fixture snack", source: { kind: "entries", entryIds: [food.id] } }));
  assert.ok(data(await rpc(alex.tokens.access_token, "get_saved_meals")).meals.some((meal: { id: string }) => meal.id === preset.id));
  const repeated = data(await rpc(alex.tokens.access_token, "log_existing_meal", { requestId: "browser-log-preset", source: { kind: "saved", id: preset.id }, date: fixture.date, mealType: "SNACK" }));
  assert.ok(repeated.saved);
  data(await rpc(alex.tokens.access_token, "correct_meal_entries", { requestId: "browser-correct-food", entries: [{ action: "update", entryId: food.id, expectedUpdatedAt: food.updatedAt, multiplier: 0.5 }] }));
  const shared = data(await rpc(alex.tokens.access_token, "share_meal", { requestId: "browser-share", source: { kind: "saved", id: preset.id }, recipientId: fixture.jamie.id, confirmed: true, date: fixture.date, mealType: "SNACK" }));
  assert.equal(shared.savedToRecipientLog, false);
  const inbox = data(await rpc(jamie.tokens.access_token, "get_buddy_meals"));
  assert.ok(inbox.incoming.some((proposal: { id: string }) => proposal.id === shared.proposalId));
  data(await rpc(jamie.tokens.access_token, "respond_shared_meal", { requestId: "browser-accept", proposalId: shared.proposalId, action: "accept", date: fixture.date, mealType: "SNACK", multiplier: 0.5 }));
  assert.equal(data(await rpc(jamie.tokens.access_token, "get_day", { date: fixture.date })).entryCount, 1);
  const buddyDay = data(await rpc(alex.tokens.access_token, "get_buddy_day", { buddyId: fixture.jamie.id, date: fixture.date }));
  assert.equal(buddyDay.buddy.id, fixture.jamie.id);
  assert.equal(buddyDay.entries.length, 1);
  assert.equal(buddyDay.weight, undefined);
  pass("saved-meal logging, portion correction, recipient-approved sharing and accepted buddy daily logs over HTTP");
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
  writeFileSync(`.test-state/mcp-browser/report-${browserName}.json`, JSON.stringify({ fixtureOnly: true, browser: browserName, steps, pageErrors: errors }, null, 2), { mode: 0o600 });
} finally {
  await Promise.all(contexts.map(context => context.close()));
  await browser.close(); await prisma.$disconnect();
  await new Promise<void>(resolve => callbackServer.close(() => resolve()));
}
