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
async function connect(user: { id: string; username: string }, clientId: string, reloadConsent: boolean) {
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
  const alex = await connect(fixture.alex, client.client_id, true);
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
