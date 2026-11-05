import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { getMcpConfig, MCP_SCOPES } from "@/lib/oauth-config";
export { getMcpConfig } from "@/lib/oauth-config";

export function hashCredential(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function authenticateMcpRequest(request: Request): Promise<{ userId: string; scopes: string[]; connectionId: string } | null> {
  const config = getMcpConfig();
  if (!config.enabled) return null;
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer (nta_[A-Za-z0-9_-]{43})$/i.exec(authorization);
  if (!match) return null;
  const token = await prisma.oAuthAccessToken.findUnique({ where: { hash: hashCredential(match[1]) }, include: { connection: true } });
  const now = new Date();
  if (!token || token.expiresAt <= now || token.connection.revokedAt || token.connection.expiresAt <= now || token.connection.resource !== config.resource) return null;
  return { userId: token.connection.userId, scopes: token.connection.scopes, connectionId: token.connectionId };
}

export function mcpUnauthorized(): Response {
  const { origin } = getMcpConfig();
  return Response.json({ error: "unauthorized", message: "Connect your NutriTracker account to continue." }, { status: 401, headers: {
    "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/api/mcp", scope="${MCP_SCOPES.join(" ")}"`,
    "Cache-Control": "no-store",
  } });
}

/** Fixed windows use an atomic UPSERT so parallel/serverless requests share a limit. */
export async function consumeMcpRateLimit(key: string, limit: number, windowSeconds = 60): Promise<boolean> {
  const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
  const hashedKey = hashCredential(`${key}:${bucket}`);
  const expiresAt = new Date((bucket + 2) * windowSeconds * 1000);
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "OAuthRateLimit" ("key", "count", "expiresAt") VALUES (${hashedKey}, 1, ${expiresAt})
    ON CONFLICT ("key") DO UPDATE SET "count" = "OAuthRateLimit"."count" + 1
    RETURNING "count"`;
  // Every call removes only expired rate buckets; never credentials or user records.
  await prisma.oAuthRateLimit.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return rows[0].count <= limit;
}
