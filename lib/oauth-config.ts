/** Safe in middleware: deliberately has no database or Node crypto imports. */
export function safeOAuthReturn(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 8192 || !value.startsWith("/oauth/authorize?") || value.includes("\\")) return null;
  try {
    const url = new URL(value, "https://nutritracker.invalid");
    return url.origin === "https://nutritracker.invalid" && url.pathname === "/oauth/authorize" && !url.hash
      ? `${url.pathname}${url.search}` : null;
  } catch { return null; }
}

export function getMcpConfig() {
  const enabled = process.env.MCP_ENABLED === "true";
  const raw = process.env.MCP_PUBLIC_URL;
  if (!raw && !enabled) return { enabled, origin: "", resource: "" };
  if (!raw) throw new Error("MCP_PUBLIC_URL must be configured before enabling MCP.");
  const url = new URL(raw);
  const local = process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("MCP_PUBLIC_URL must be an HTTPS origin with no path, credentials, query or fragment.");
  }
  return { enabled, origin: url.origin, resource: `${url.origin}/api/mcp` };
}

export const MCP_SCOPES = ["nutrition:read", "nutrition:write"] as const;

export function allowedRedirectUris(): string[] {
  const redirects = ["https://claude.ai/api/mcp/auth_callback", ...(process.env.MCP_ALLOWED_REDIRECT_URIS ?? "").split(",").map(value => value.trim()).filter(Boolean)];
  for (const value of redirects) {
    const url = new URL(value);
    const local = process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password || url.hash) throw new Error("Invalid configured OAuth callback URL.");
  }
  return [...new Set(redirects)];
}
