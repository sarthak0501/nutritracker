import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { consumeMcpRateLimit, hashCredential } from "@/lib/mcp-auth";
import { allowedRedirectUris, getMcpConfig, MCP_SCOPES } from "@/lib/oauth-config";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const ACCESS_SECONDS = 3600;
export class OAuthError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
export function oauthErrorResponse(error: unknown): Response {
  const known = error instanceof OAuthError;
  if (!known) console.error("OAuth request failed", error instanceof Error ? error.name : "UnknownError");
  return Response.json({ error: known ? error.code : "server_error", error_description: known ? error.message : "Unable to complete authorization. Please try again." }, { status: known ? error.status : 500, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });
}
export function oauthJson(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });
}
export function requireMcpEnabled() {
  const config = getMcpConfig();
  if (!config.enabled) throw new OAuthError("not_found", "MCP is not enabled.", 404);
  return config;
}
export async function limitOAuthRequest(request: Request, endpoint: string) {
  // The global limit remains effective even on hosts without a trusted proxy IP.
  const ip = request.headers.get("x-vercel-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const globalAllowed = await consumeMcpRateLimit(`oauth:${endpoint}:global`, 300);
  const callerAllowed = await consumeMcpRateLimit(`oauth:${endpoint}:ip:${ip}`, 60);
  if (!globalAllowed || !callerAllowed) throw new OAuthError("temporarily_unavailable", "Too many requests. Try again in a minute.", 429);
}
export async function boundedBody(request: Request): Promise<string> {
  if (Number(request.headers.get("content-length") ?? 0) > 16_384) throw new OAuthError("invalid_request", "Request too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) return "";
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 16_384) { await reader.cancel(); throw new OAuthError("invalid_request", "Request too large.", 413); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
export async function formBody(request: Request): Promise<URLSearchParams> {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/x-www-form-urlencoded") throw new OAuthError("invalid_request", "Use application/x-www-form-urlencoded.", 415);
  const params = new URLSearchParams(await boundedBody(request));
  rejectDuplicateParameters(params);
  return params;
}
export function rejectDuplicateParameters(params: URLSearchParams) {
  for (const key of new Set(params.keys())) if (params.getAll(key).length > 1) throw new OAuthError("invalid_request", "Repeated parameters are not supported.");
}
function required(params: URLSearchParams, name: string): string {
  const value = params.get(name);
  if (!value || value.length > 4096) throw new OAuthError("invalid_request", `Missing or invalid ${name}.`);
  return value;
}
function scopesFrom(value: string | null): string[] {
  const scopes = [...new Set((value ?? "nutrition:read nutrition:write").split(" ").filter(Boolean))];
  if (!scopes.length || scopes.some(scope => !MCP_SCOPES.includes(scope as typeof MCP_SCOPES[number]))) throw new OAuthError("invalid_scope", "Requested permissions are not supported.");
  return scopes;
}

export async function registerOAuthClient(body: unknown) {
  requireMcpEnabled();
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new OAuthError("invalid_client_metadata", "Expected a registration object.");
  const metadata = body as Record<string, unknown>;
  const uris = metadata.redirect_uris;
  if (!Array.isArray(uris) || !uris.length || uris.length > 5 || uris.some(uri => typeof uri !== "string" || !allowedRedirectUris().includes(uri))) throw new OAuthError("invalid_redirect_uri", "Only explicitly configured callback URLs are allowed.");
  if (metadata.token_endpoint_auth_method !== undefined && metadata.token_endpoint_auth_method !== "none") throw new OAuthError("invalid_client_metadata", "Only public clients using S256 PKCE are supported.");
  if (metadata.grant_types !== undefined && (!Array.isArray(metadata.grant_types) || metadata.grant_types.some(grant => !["authorization_code", "refresh_token"].includes(String(grant))))) throw new OAuthError("invalid_client_metadata", "Unsupported grant type.");
  if (metadata.response_types !== undefined && (!Array.isArray(metadata.response_types) || metadata.response_types.some(value => value !== "code"))) throw new OAuthError("invalid_client_metadata", "Only the code response type is supported.");
  const redirectUris = [...new Set(uris as string[])].sort();
  const registrationKey = hashCredential(JSON.stringify(redirectUris));
  // Client name/logo/URLs are untrusted and are neither fetched nor used as identity.
  const name = redirectUris.every(uri => uri === "https://claude.ai/api/mcp/auth_callback") ? "Claude" : "Configured assistant";
  const client = await prisma.oAuthClient.upsert({ where: { registrationKey }, create: { registrationKey, name, redirectUris }, update: {} });
  return { client_id: client.id, client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000), client_name: client.name, redirect_uris: client.redirectUris, token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], scope: MCP_SCOPES.join(" ") };
}

export type AuthorizationRequest = { clientId: string; clientName: string; redirectUri: string; codeChallenge: string; scopes: string[]; resource: string; state: string | null };
export async function validateAuthorizationRequest(params: URLSearchParams): Promise<AuthorizationRequest> {
  const config = requireMcpEnabled();
  rejectDuplicateParameters(params);
  const clientId = required(params, "client_id");
  const redirectUri = required(params, "redirect_uri");
  const client = await prisma.oAuthClient.findUnique({ where: { id: clientId } });
  if (!client || !client.redirectUris.includes(redirectUri) || !allowedRedirectUris().includes(redirectUri)) throw new OAuthError("invalid_request", "Unknown client or callback URL.");
  if (params.get("response_type") !== "code") throw new OAuthError("unsupported_response_type", "Only authorization codes are supported.");
  if (params.get("resource") !== config.resource) throw new OAuthError("invalid_target", "The resource must match this NutriTracker MCP URL.");
  const codeChallenge = required(params, "code_challenge");
  if (params.get("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) throw new OAuthError("invalid_request", "S256 PKCE is required.");
  const state = params.get("state");
  if (state && state.length > 2048) throw new OAuthError("invalid_request", "State is too long.");
  return { clientId, clientName: client.name, redirectUri, codeChallenge, scopes: scopesFrom(params.get("scope")), resource: config.resource, state };
}
function consentSecret(): Uint8Array {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is required.");
  // Separate signing domains: a consent JWT must never be a browser session JWT.
  return createHmac("sha256", value).update("nutritracker:oauth-consent:v1").digest();
}
export async function signConsent(userId: string, request: AuthorizationRequest) {
  const config = requireMcpEnabled();
  return new SignJWT({ request }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setSubject(userId).setIssuer(config.origin).setAudience("nutritracker-oauth-consent").setJti(randomBytes(32).toString("base64url")).setIssuedAt().setExpirationTime("10m").sign(consentSecret());
}
export async function readConsent(token: string, userId: string): Promise<{ request: AuthorizationRequest; consentId: string }> {
  const config = requireMcpEnabled();
  try {
    const { payload } = await jwtVerify(token, consentSecret(), { algorithms: ["HS256"], issuer: config.origin, audience: "nutritracker-oauth-consent" });
    if (payload.sub !== userId || typeof payload.jti !== "string" || !payload.request || typeof payload.request !== "object") throw new Error("Invalid subject");
    const request = payload.request as AuthorizationRequest;
    // Validate against current registration/config as well as the signed payload.
    const params = new URLSearchParams({ client_id: request.clientId, redirect_uri: request.redirectUri, response_type: "code", resource: request.resource, code_challenge: request.codeChallenge, code_challenge_method: "S256", scope: request.scopes.join(" ") });
    if (request.state !== null) params.set("state", request.state);
    return { request: await validateAuthorizationRequest(params), consentId: payload.jti };
  } catch { throw new OAuthError("invalid_request", "This connection request expired or belongs to another account. Start again from Claude."); }
}
export function authorizationRedirect(request: AuthorizationRequest, values: Record<string, string>) {
  const url = new URL(request.redirectUri);
  for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value);
  if (request.state !== null) url.searchParams.set("state", request.state);
  return url.toString();
}
export async function approveConsent(userId: string, signedConsent: string): Promise<string> {
  const { request, consentId } = await readConsent(signedConsent, userId);
  const code = `ntc_${randomBytes(32).toString("base64url")}`;
  try {
    await prisma.oAuthAuthorizationCode.create({ data: { hash: hashCredential(code), consentId, userId, clientId: request.clientId, redirectUri: request.redirectUri, codeChallenge: request.codeChallenge, scopes: request.scopes, resource: request.resource, expiresAt: new Date(Date.now() + 5 * MINUTE) } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new OAuthError("invalid_request", "This consent was already submitted. Start a new connection from Claude.");
    throw error;
  }
  return authorizationRedirect(request, { code });
}
function pkceMatches(verifier: string, challenge: string) {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const digest = createHash("sha256").update(verifier).digest("base64url");
  return digest.length === challenge.length && timingSafeEqual(Buffer.from(digest), Buffer.from(challenge));
}
async function createTokens(tx: Prisma.TransactionClient, connection: { id: string; scopes: string[]; expiresAt: Date }) {
  const accessToken = `nta_${randomBytes(32).toString("base64url")}`;
  const refreshToken = `ntr_${randomBytes(32).toString("base64url")}`;
  const accessExpiry = new Date(Math.min(Date.now() + ACCESS_SECONDS * 1000, connection.expiresAt.getTime()));
  await tx.oAuthAccessToken.create({ data: { hash: hashCredential(accessToken), connectionId: connection.id, expiresAt: accessExpiry } });
  await tx.oAuthRefreshToken.create({ data: { hash: hashCredential(refreshToken), connectionId: connection.id, expiresAt: new Date(Math.min(Date.now() + 30 * DAY, connection.expiresAt.getTime())) } });
  return { access_token: accessToken, token_type: "Bearer", expires_in: Math.max(0, Math.floor((accessExpiry.getTime() - Date.now()) / 1000)), refresh_token: refreshToken, scope: connection.scopes.join(" ") };
}
export async function exchangeOAuthToken(params: URLSearchParams) {
  const config = requireMcpEnabled();
  rejectDuplicateParameters(params);
  const clientId = required(params, "client_id");
  if (params.get("resource") !== config.resource) throw new OAuthError("invalid_target", "The resource must match this NutriTracker MCP URL.");
  const grant = params.get("grant_type");
  if (grant === "authorization_code") {
    const codeHash = hashCredential(required(params, "code"));
    const redirectUri = required(params, "redirect_uri");
    const verifier = required(params, "code_verifier");
    return prisma.$transaction(async tx => {
      const code = await tx.oAuthAuthorizationCode.findUnique({ where: { hash: codeHash } });
      if (!code || code.consumedAt || code.expiresAt <= new Date() || code.clientId !== clientId || code.redirectUri !== redirectUri || !allowedRedirectUris().includes(redirectUri) || code.resource !== config.resource || !pkceMatches(verifier, code.codeChallenge)) throw new OAuthError("invalid_grant", "The authorization code is invalid, expired or already used.");
      const claimed = await tx.oAuthAuthorizationCode.updateMany({ where: { hash: codeHash, consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } });
      if (claimed.count !== 1) throw new OAuthError("invalid_grant", "The authorization code was already used.");
      const connection = await tx.oAuthConnection.create({ data: { userId: code.userId, clientId, scopes: code.scopes, resource: code.resource, expiresAt: new Date(Date.now() + 90 * DAY) } });
      return createTokens(tx, connection);
    });
  }
  if (grant === "refresh_token") {
    const hash = hashCredential(required(params, "refresh_token"));
    const result = await prisma.$transaction(async tx => {
      const token = await tx.oAuthRefreshToken.findUnique({ where: { hash }, include: { connection: true } });
      if (!token || token.connection.clientId !== clientId || token.connection.resource !== config.resource || token.connection.revokedAt || token.connection.expiresAt <= new Date() || token.expiresAt <= new Date()) return null;
      if (params.has("scope") && params.get("scope") !== token.connection.scopes.join(" ")) throw new OAuthError("invalid_scope", "Refresh cannot change the granted permissions.");
      const claimed = await tx.oAuthRefreshToken.updateMany({ where: { hash, consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } });
      if (!claimed.count) {
        // A replay compromises the whole grant. Return the error after committing revocation.
        await tx.oAuthConnection.update({ where: { id: token.connectionId }, data: { revokedAt: new Date() } });
        return null;
      }
      return createTokens(tx, token.connection);
    });
    if (!result) throw new OAuthError("invalid_grant", "The refresh token is invalid, expired or already used. Connect again.");
    return result;
  }
  throw new OAuthError("unsupported_grant_type", "Only authorization_code and refresh_token grants are supported.");
}
export async function revokeOAuthToken(params: URLSearchParams) {
  requireMcpEnabled();
  const clientId = required(params, "client_id");
  const hash = hashCredential(required(params, "token"));
  const token = await prisma.oAuthRefreshToken.findUnique({ where: { hash }, include: { connection: true } }) ?? await prisma.oAuthAccessToken.findUnique({ where: { hash }, include: { connection: true } });
  if (token?.connection.clientId === clientId) await prisma.oAuthConnection.updateMany({ where: { id: token.connectionId, clientId, revokedAt: null }, data: { revokedAt: new Date() } });
}
export async function revokeUserConnection(userId: string, connectionId: string) {
  return prisma.oAuthConnection.updateMany({ where: { id: connectionId, userId, revokedAt: null }, data: { revokedAt: new Date() } });
}
export function authorizationMetadata() {
  const { origin } = requireMcpEnabled();
  return { issuer: origin, authorization_endpoint: `${origin}/oauth/authorize`, token_endpoint: `${origin}/oauth/token`, registration_endpoint: `${origin}/oauth/register`, revocation_endpoint: `${origin}/oauth/revoke`, response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], token_endpoint_auth_methods_supported: ["none"], revocation_endpoint_auth_methods_supported: ["none"], code_challenge_methods_supported: ["S256"], scopes_supported: MCP_SCOPES };
}
export function protectedResourceMetadata() {
  const { origin, resource } = requireMcpEnabled();
  return { resource, resource_name: "NutriTracker", authorization_servers: [origin], scopes_supported: MCP_SCOPES, bearer_methods_supported: ["header"] };
}
