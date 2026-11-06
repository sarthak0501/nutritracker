import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { SignJWT } from "jose";
import { NextRequest } from "next/server";
import { middleware } from "../middleware";
import { prisma } from "../lib/db";
import { getSessionSecret, verifySessionToken } from "../lib/auth-token";
import { authenticateMcpRequest, consumeMcpRateLimit, hashCredential, mcpUnauthorized } from "../lib/mcp-auth";
import { allowedRedirectUris, getMcpConfig, MCP_SCOPES, optionalConsentScopes, safeOAuthReturn } from "../lib/oauth-config";
import { approveConsent, authorizationMetadata, authorizationRedirect, exchangeOAuthToken, OAuthError, protectedResourceMetadata, readConsent, registerOAuthClient, revokeOAuthToken, revokeUserConnection, selectedConsentScopes, signConsent, validateAuthorizationRequest } from "../lib/oauth";
import { POST as registerRoute } from "../app/oauth/register/route";
import { POST as tokenRoute } from "../app/oauth/token/route";
import { POST as consentRoute } from "../app/oauth/consent/route";

const database = new URL(process.env.DATABASE_URL || "file:///missing-fixture-database");
assert.equal(database.protocol, "postgresql:", "Use scripts/test-db.mjs run; never an application DB");
assert.equal(database.hostname, "localhost");
assert.equal(database.username, "nt_fixture");
assert.equal(database.pathname, "/nutritracker_test");
assert.match(database.searchParams.get("host") || "", /^\/.*\/nt-fixture-[a-f0-9]{12}\/socket$/);
const original = { MCP_ENABLED: process.env.MCP_ENABLED, MCP_PUBLIC_URL: process.env.MCP_PUBLIC_URL, MCP_ALLOWED_REDIRECT_URIS: process.env.MCP_ALLOWED_REDIRECT_URIS, AUTH_SECRET: process.env.AUTH_SECRET };
const origin = "https://fixture.nutritracker.invalid";
const resource = `${origin}/api/mcp`;
const callback = `https://fixture-callback.invalid/${randomUUID()}`;
const userIds: string[] = [];
const clientIds: string[] = [];
let firstUser: string;
let secondUser: string;
let clientId: string;
function isOAuth(code: string) { return (error: unknown) => error instanceof OAuthError && error.code === code; }

before(async () => {
  const [settings] = await prisma.$queryRaw<Array<{ database: string; listen: string }>>`SELECT current_database() AS database, current_setting('listen_addresses') AS listen`;
  assert.equal(settings.database, "nutritracker_test");
  assert.equal(settings.listen, "");
  process.env.MCP_ENABLED = "true";
  process.env.MCP_PUBLIC_URL = origin;
  process.env.MCP_ALLOWED_REDIRECT_URIS = callback;
  process.env.AUTH_SECRET = randomBytes(32).toString("hex");
  for (let i = 0; i < 2; i++) {
    const user = await prisma.user.create({ data: { username: `fixture-oauth-${randomUUID()}`, passwordHash: "fixture-no-login" } });
    userIds.push(user.id);
  }
  [firstUser, secondUser] = userIds;
  const client = await registerOAuthClient({ redirect_uris: [callback], token_endpoint_auth_method: "none" });
  clientId = client.client_id;
  clientIds.push(clientId);
});
after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.oAuthClient.deleteMany({ where: { id: { in: clientIds } } });
  await prisma.$disconnect();
  for (const [key, value] of Object.entries(original)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});
async function authorization(userId = firstUser, scope = "nutrition:read nutrition:write", registered = { id: clientId, uri: callback }) {
  const verifier = randomBytes(48).toString("base64url");
  const params = new URLSearchParams({ client_id: registered.id, redirect_uri: registered.uri, response_type: "code", resource, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", state: `state & ${randomUUID()}`, scope });
  const request = await validateAuthorizationRequest(params);
  const consent = await signConsent(userId, request);
  return { verifier, params, request, consent, userId };
}
async function grant(userId = firstUser, scope?: string) {
  const auth = await authorization(userId, scope);
  const redirect = new URL(await approveConsent(userId, auth.consent));
  assert.equal(redirect.origin, new URL(callback).origin);
  assert.equal(redirect.searchParams.get("state"), auth.request.state);
  const code = redirect.searchParams.get("code")!;
  const params = new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, redirect_uri: callback, resource, code_verifier: auth.verifier, code });
  return { ...auth, code, tokenParams: params };
}
async function access(token: string) { return authenticateMcpRequest(new Request(resource, { headers: { Authorization: `Bearer ${token}` } })); }
function refreshParams(refreshToken: string) { return new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, resource, refresh_token: refreshToken }); }

test("discovery and authentication challenge bind to the canonical MCP resource", () => {
  assert.equal(protectedResourceMetadata().resource, resource);
  assert.deepEqual(protectedResourceMetadata().authorization_servers, [origin]);
  assert.deepEqual(authorizationMetadata().code_challenge_methods_supported, ["S256"]);
  assert.equal(authorizationMetadata().registration_endpoint, `${origin}/oauth/register`);
  assert.deepEqual(authorizationMetadata().scopes_supported, MCP_SCOPES);
  assert.equal(mcpUnauthorized().status, 401);
  assert.match(mcpUnauthorized().headers.get("www-authenticate")!, /oauth-protected-resource\/api\/mcp/);
  assert.equal(safeOAuthReturn("https://evil.invalid/oauth/authorize?x=1"), null);
  assert.equal(safeOAuthReturn("//evil.invalid/oauth/authorize?x=1"), null);
  assert.equal(safeOAuthReturn("/oauth/authorize?x=1\\evil"), null);
  assert.equal(safeOAuthReturn("/oauth/authorize?x=1"), "/oauth/authorize?x=1");
  assert.equal(safeOAuthReturn("/oauth/authorize/../other?x=1"), null);
});

test("registration rejects arbitrary redirects and untrusted client identity", async () => {
  await assert.rejects(registerOAuthClient({ redirect_uris: ["https://evil.invalid/callback"] }), isOAuth("invalid_redirect_uri"));
  await assert.rejects(registerOAuthClient({ redirect_uris: [callback], token_endpoint_auth_method: "client_secret_post" }), isOAuth("invalid_client_metadata"));
  const repeated = await registerOAuthClient({ redirect_uris: [callback], client_name: "Trusted bank", logo_uri: "http://127.0.0.1/secret" });
  assert.equal(repeated.client_id, clientId);
  assert.equal(repeated.client_name, "Configured assistant");
  assert.ok(allowedRedirectUris().includes("https://claude.ai/api/mcp/auth_callback"));
});

test("ChatGPT's exact stable callback supports public registration, issuer identification and PKCE exchange", async () => {
  const uri = "https://chatgpt.com/connector_platform_oauth_redirect";
  const metadata = authorizationMetadata();
  assert.equal(metadata.authorization_response_iss_parameter_supported, true);
  assert.deepEqual(protectedResourceMetadata().authorization_servers, [metadata.issuer]);
  for (const lookalike of [`${uri}/`, `${uri}?to=elsewhere`, uri.replace("chatgpt.com", "chatgpt.com.evil.invalid")]) {
    await assert.rejects(registerOAuthClient({ redirect_uris: [lookalike] }), isOAuth("invalid_redirect_uri"));
  }
  const registration = await registerRoute(new Request(metadata.registration_endpoint, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_name: "An untrusted name", redirect_uris: [uri], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }),
  }));
  assert.equal(registration.status, 201);
  const client = await registration.json();
  clientIds.push(client.client_id);
  assert.equal(client.client_name, "ChatGPT");
  assert.equal(client.token_endpoint_auth_method, "none");
  assert.equal(client.client_secret, undefined);
  const auth = await authorization(firstUser, "nutrition:read", { id: client.client_id, uri });
  const approved = new URL(await approveConsent(firstUser, auth.consent));
  const denied = new URL(authorizationRedirect(auth.request, { error: "access_denied" }));
  for (const response of [approved, denied]) {
    assert.equal(response.origin + response.pathname, uri);
    assert.deepEqual(response.searchParams.getAll("iss"), [metadata.issuer]);
    assert.equal(response.searchParams.get("state"), auth.request.state);
  }
  assert.equal(denied.searchParams.get("code"), null);
  assert.equal(denied.searchParams.get("error"), "access_denied");
  const tokenForm = new URLSearchParams({ grant_type: "authorization_code", client_id: client.client_id, code: approved.searchParams.get("code")!, code_verifier: auth.verifier, resource, redirect_uri: uri });
  const substituted = new URLSearchParams(tokenForm);
  substituted.set("redirect_uri", "https://claude.ai/api/mcp/auth_callback");
  await assert.rejects(exchangeOAuthToken(substituted), isOAuth("invalid_grant"));
  const token = await tokenRoute(new Request(metadata.token_endpoint, { method: "POST", body: tokenForm }));
  assert.equal(token.status, 200);
  const identity = await access((await token.json()).access_token);
  assert.equal(identity?.userId, firstUser);
  assert.deepEqual(identity?.scopes, ["nutrition:read"]);
});

test("authorization rejects missing PKCE, wrong resource, duplicate and unregistered parameters", async () => {
  const { params } = await authorization();
  for (const [key, value, code] of [["code_challenge_method", "plain", "invalid_request"], ["resource", "https://evil.invalid", "invalid_target"], ["redirect_uri", "https://evil.invalid/callback", "invalid_request"], ["scope", "admin", "invalid_scope"]]) {
    const bad = new URLSearchParams(params); bad.set(key, value);
    await assert.rejects(validateAuthorizationRequest(bad), isOAuth(code));
  }
  const duplicate = new URLSearchParams(params); duplicate.append("client_id", clientId);
  await assert.rejects(validateAuthorizationRequest(duplicate), isOAuth("invalid_request"));
});

test("signed consent is user-bound, tamper resistant and single-use", async () => {
  const auth = await authorization();
  await assert.rejects(readConsent(auth.consent, secondUser), isOAuth("invalid_request"));
  await assert.rejects(readConsent(`${auth.consent.slice(0, -12)}tampered`, firstUser), isOAuth("invalid_request"));
  await approveConsent(firstUser, auth.consent);
  await assert.rejects(approveConsent(firstUser, auth.consent), isOAuth("invalid_request"));
  for (const requestOrigin of ["https://evil.invalid", "null", undefined]) {
    const headers = new Headers({ "Content-Type": "application/x-www-form-urlencoded" });
    if (requestOrigin !== undefined) headers.set("Origin", requestOrigin);
    const badOrigin = await consentRoute(new Request(`${origin}/oauth/consent`, { method: "POST", headers, body: new URLSearchParams({ consent: auth.consent, decision: "allow" }) }));
    assert.equal(badOrigin.status, 403);
  }
});

test("cached nutrition scopes gain only explicitly selected signed optional permissions", async () => {
  const old = await exchangeOAuthToken((await grant()).tokenParams);
  const auth = await authorization();
  const offered = optionalConsentScopes(auth.request.scopes);
  assert.ok(offered.includes("workouts:write"));
  assert.ok(offered.includes("wellness:read"));
  const consent = await signConsent(firstUser, auth.request, offered);
  assert.deepEqual((await readConsent(consent, firstUser)).offeredScopes, offered);
  const selected = selectedConsentScopes(new URLSearchParams({ allow_workouts: "yes", allow_wellness: "yes" }), offered);
  assert.deepEqual(selected, ["workouts:read", "workouts:write", "wellness:read", "wellness:write"]);
  const redirect = new URL(await approveConsent(firstUser, consent, selected));
  const upgraded = await exchangeOAuthToken(new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, redirect_uri: callback, resource, code_verifier: auth.verifier, code: redirect.searchParams.get("code")! }));
  assert.deepEqual((await access(upgraded.access_token))!.scopes, [...auth.request.scopes, ...selected]);
  assert.equal(upgraded.scope, [...auth.request.scopes, ...selected].join(" "));
  assert.ok(!upgraded.scope.includes("sharing:"));
  assert.ok(!upgraded.scope.includes("meals:"));
  const refreshedOld = await exchangeOAuthToken(refreshParams(old.refresh_token));
  assert.equal(refreshedOld.scope, "nutrition:read nutrition:write");
  assert.deepEqual((await access(old.access_token))!.scopes, ["nutrition:read", "nutrition:write"]);
  const illegalRefresh = refreshParams(refreshedOld.refresh_token); illegalRefresh.set("scope", MCP_SCOPES.join(" "));
  await assert.rejects(exchangeOAuthToken(illegalRefresh), isOAuth("invalid_scope"));
  const refreshedNew = await exchangeOAuthToken(refreshParams(upgraded.refresh_token));
  assert.equal(refreshedNew.scope, upgraded.scope);
});

test("unchecked offers stay disabled and unoffered or forged permission selections fail closed", async () => {
  const auth = await authorization();
  assert.deepEqual((await readConsent(auth.consent, firstUser)).offeredScopes, []);
  await assert.rejects(approveConsent(firstUser, auth.consent, ["workouts:write"]), isOAuth("invalid_scope"));
  await assert.rejects(signConsent(firstUser, auth.request, ["admin"]), isOAuth("invalid_scope"));
  const offered = ["workouts:read", "workouts:write"];
  const consent = await signConsent(firstUser, auth.request, offered);
  assert.throws(() => selectedConsentScopes(new URLSearchParams({ allow_workouts: "true" }), offered), isOAuth("invalid_scope"));
  assert.throws(() => selectedConsentScopes(new URLSearchParams({ allow_sharing: "yes" }), offered), isOAuth("invalid_scope"));
  assert.throws(() => selectedConsentScopes(new URLSearchParams({ allow_admin: "yes" }), offered), isOAuth("invalid_scope"));
  assert.deepEqual(selectedConsentScopes(new URLSearchParams(), offered), []);
  await assert.rejects(approveConsent(firstUser, consent, ["sharing:write"]), isOAuth("invalid_scope"));
  await assert.rejects(approveConsent(secondUser, consent, offered), isOAuth("invalid_request"));
  const redirect = new URL(await approveConsent(firstUser, consent));
  const tokens = await exchangeOAuthToken(new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, redirect_uri: callback, resource, code_verifier: auth.verifier, code: redirect.searchParams.get("code")! }));
  assert.equal(tokens.scope, "nutrition:read nutrition:write");
  await assert.rejects(approveConsent(firstUser, consent, offered), isOAuth("invalid_request"));
});

test("explicitly requested expanded scopes are shown in signed consent without optional duplication", async () => {
  const auth = await authorization(firstUser, MCP_SCOPES.join(" "));
  assert.deepEqual(optionalConsentScopes(auth.request.scopes), []);
  assert.deepEqual((await readConsent(auth.consent, firstUser)).request.scopes, [...MCP_SCOPES]);
  const tokens = await exchangeOAuthToken((await grant(firstUser, MCP_SCOPES.join(" "))).tokenParams);
  assert.equal(tokens.scope, MCP_SCOPES.join(" "));
});

test("consent and malformed JWTs cannot impersonate browser sessions", async () => {
  const auth = await authorization();
  assert.equal(await verifySessionToken(auth.consent), null);
  const legacyConfusedToken = await new SignJWT({ sub: firstUser, request: auth.request }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("10m").sign(getSessionSecret());
  assert.equal(await verifySessionToken(legacyConfusedToken), null);
  const wrongAlgorithm = await new SignJWT({ id: firstUser, username: "fixture" }).setProtectedHeader({ alg: "HS384" }).setExpirationTime("10m").sign(getSessionSecret());
  assert.equal(await verifySessionToken(wrongAlgorithm), null);
  const realSession = await new SignJWT({ id: firstUser, username: "fixture" }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("10m").sign(getSessionSecret());
  assert.deepEqual(await verifySessionToken(realSession), { id: firstUser, username: "fixture" });
  await assert.rejects(readConsent(realSession, firstUser), isOAuth("invalid_request"));
});

test("middleware exposes only the exact protocol routes and rejects a consent cookie", async () => {
  const { consent } = await authorization();
  const forbidden = await middleware(new NextRequest(`${origin}/connections`, { headers: { cookie: `nt_session=${consent}` } }));
  assert.equal(forbidden.status, 307);
  assert.equal(new URL(forbidden.headers.get("location")!).pathname, "/login");
  for (const path of ["/api/mcp", "/oauth/token", "/oauth/authorize", "/oauth/consent", "/.well-known/oauth-protected-resource/api/mcp"]) {
    const publicRoute = await middleware(new NextRequest(`${origin}${path}`));
    assert.equal(publicRoute.headers.get("x-middleware-next"), "1");
    assert.equal(publicRoute.headers.get("referrer-policy"), path === "/oauth/authorize" ? "strict-origin" : "no-referrer");
  }
  for (const path of ["/api/mcp/admin", "/oauth/admin", "/api/foods"]) {
    const privateRoute = await middleware(new NextRequest(`${origin}${path}`));
    assert.equal(privateRoute.status, 307);
  }
});

test("codes require exact client, audience and PKCE; concurrent redemption issues one grant", async () => {
  const auth = await grant();
  const wrongVerifier = new URLSearchParams(auth.tokenParams); wrongVerifier.set("code_verifier", "x".repeat(43));
  await assert.rejects(exchangeOAuthToken(wrongVerifier), isOAuth("invalid_grant"));
  const wrongClient = new URLSearchParams(auth.tokenParams); wrongClient.set("client_id", "someone-else");
  await assert.rejects(exchangeOAuthToken(wrongClient), isOAuth("invalid_grant"));
  const wrongResource = new URLSearchParams(auth.tokenParams); wrongResource.set("resource", `${origin}/other`);
  await assert.rejects(exchangeOAuthToken(wrongResource), isOAuth("invalid_target"));
  const results = await Promise.allSettled([exchangeOAuthToken(auth.tokenParams), exchangeOAuthToken(auth.tokenParams)]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const fulfilled = results.find(result => result.status === "fulfilled") as PromiseFulfilledResult<Awaited<ReturnType<typeof exchangeOAuthToken>>>;
  const token = fulfilled.value;
  const identity = await access(token.access_token);
  assert.equal(identity?.userId, firstUser);
  const storedCode = await prisma.oAuthAuthorizationCode.findUniqueOrThrow({ where: { hash: hashCredential(auth.code) } });
  assert.ok(storedCode.consumedAt);
  assert.notEqual(storedCode.hash, auth.code);
  assert.ok(await prisma.oAuthAccessToken.findUnique({ where: { hash: hashCredential(token.access_token) } }));
  assert.equal(await prisma.oAuthAccessToken.findUnique({ where: { hash: token.access_token } }), null);
});

test("two users retain separate grants and cannot revoke each other's account", async () => {
  const a = await exchangeOAuthToken((await grant(firstUser, "nutrition:read")).tokenParams);
  const b = await exchangeOAuthToken((await grant(secondUser)).tokenParams);
  const identityA = (await access(a.access_token))!;
  const identityB = (await access(b.access_token))!;
  assert.equal(identityA.userId, firstUser);
  assert.equal(identityB.userId, secondUser);
  assert.deepEqual(identityA.scopes, ["nutrition:read"]);
  assert.equal((await revokeUserConnection(secondUser, identityA.connectionId)).count, 0);
  assert.ok(await access(a.access_token));
  assert.equal((await revokeUserConnection(firstUser, identityA.connectionId)).count, 1);
  assert.equal(await access(a.access_token), null);
  assert.ok(await access(b.access_token));
  await assert.rejects(exchangeOAuthToken(refreshParams(a.refresh_token)), isOAuth("invalid_grant"));
});

test("refresh rotates and replay revokes the full token family", async () => {
  const originalTokens = await exchangeOAuthToken((await grant()).tokenParams);
  const rotated = await exchangeOAuthToken(refreshParams(originalTokens.refresh_token));
  assert.notEqual(rotated.refresh_token, originalTokens.refresh_token);
  assert.ok(await access(rotated.access_token));
  await assert.rejects(exchangeOAuthToken(refreshParams(originalTokens.refresh_token)), isOAuth("invalid_grant"));
  assert.equal(await access(rotated.access_token), null);
  await assert.rejects(exchangeOAuthToken(refreshParams(rotated.refresh_token)), isOAuth("invalid_grant"));
});

test("concurrent refresh requests cannot create two valid grants", async () => {
  const initial = await exchangeOAuthToken((await grant()).tokenParams);
  const attempts = await Promise.allSettled([exchangeOAuthToken(refreshParams(initial.refresh_token)), exchangeOAuthToken(refreshParams(initial.refresh_token))]);
  assert.equal(attempts.filter(result => result.status === "fulfilled").length, 1);
  const successful = attempts.find(result => result.status === "fulfilled") as PromiseFulfilledResult<Awaited<ReturnType<typeof exchangeOAuthToken>>>;
  assert.equal(await access(successful.value.access_token), null, "Replay must revoke the grant even under concurrency");
});

test("expired access, code, refresh and connection are rejected", async () => {
  const expiredCode = await grant();
  await prisma.oAuthAuthorizationCode.update({ where: { hash: hashCredential(expiredCode.code) }, data: { expiresAt: new Date(0) } });
  await assert.rejects(exchangeOAuthToken(expiredCode.tokenParams), isOAuth("invalid_grant"));
  const token = await exchangeOAuthToken((await grant()).tokenParams);
  const identity = (await access(token.access_token))!;
  await prisma.oAuthAccessToken.update({ where: { hash: hashCredential(token.access_token) }, data: { expiresAt: new Date(0) } });
  assert.equal(await access(token.access_token), null);
  await prisma.oAuthRefreshToken.update({ where: { hash: hashCredential(token.refresh_token) }, data: { expiresAt: new Date(0) } });
  await assert.rejects(exchangeOAuthToken(refreshParams(token.refresh_token)), isOAuth("invalid_grant"));
  const second = await exchangeOAuthToken((await grant()).tokenParams);
  await prisma.oAuthConnection.update({ where: { id: (await access(second.access_token))!.connectionId }, data: { expiresAt: new Date(0) } });
  assert.equal(await access(second.access_token), null);
  assert.ok(identity.connectionId);
});

test("revocation ignores other client IDs and unknown credentials but disables matching grants", async () => {
  const token = await exchangeOAuthToken((await grant()).tokenParams);
  await revokeOAuthToken(new URLSearchParams({ client_id: "wrong-client", token: token.access_token }));
  assert.ok(await access(token.access_token));
  await revokeOAuthToken(new URLSearchParams({ client_id: clientId, token: "unknown" }));
  await revokeOAuthToken(new URLSearchParams({ client_id: clientId, token: token.access_token }));
  assert.equal(await access(token.access_token), null);
});

test("HTTP registration accepts JSON and token exchange requires form encoding", async () => {
  const registration = await registerRoute(new Request(`${origin}/oauth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ redirect_uris: [callback] }) }));
  assert.equal(registration.status, 201);
  assert.equal((await registration.json()).client_id, clientId);
  const jsonToken = await tokenRoute(new Request(`${origin}/oauth/token`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }));
  assert.equal(jsonToken.status, 415);
  const auth = await grant();
  const response = await tokenRoute(new Request(`${origin}/oauth/token`, { method: "POST", body: auth.tokenParams }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await access((await response.json()).access_token))!.userId, firstUser);
});

test("durable rate limit grants only the configured number under concurrency", async () => {
  const key = `fixture-oauth-${randomUUID()}`;
  const results = await Promise.all(Array.from({ length: 12 }, () => consumeMcpRateLimit(key, 5, 3600)));
  assert.equal(results.filter(Boolean).length, 5);
});

test("disabled MCP fails closed, including existing tokens and discovery", async () => {
  const token = await exchangeOAuthToken((await grant()).tokenParams);
  process.env.MCP_ENABLED = "false";
  try {
    assert.equal(await access(token.access_token), null);
    assert.throws(() => protectedResourceMetadata(), isOAuth("not_found"));
    const disabled = await tokenRoute(new Request(`${origin}/oauth/token`, { method: "POST", body: refreshParams(token.refresh_token) }));
    assert.equal(disabled.status, 404);
  } finally { process.env.MCP_ENABLED = "true"; }
  process.env.MCP_PUBLIC_URL = `${origin}/bad-path`;
  try { assert.throws(() => getMcpConfig(), /HTTPS origin/); } finally { process.env.MCP_PUBLIC_URL = origin; }
});
