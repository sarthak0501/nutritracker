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

export const MCP_SCOPES = ["nutrition:read", "nutrition:write", "workouts:read", "workouts:write", "wellness:read", "wellness:write", "meals:read", "meals:write", "sharing:read", "sharing:write"] as const;
export type McpScope = typeof MCP_SCOPES[number];
export const MCP_SCOPE_DESCRIPTIONS: Record<McpScope, string> = {
  "nutrition:read": "Read your account name, nutrition targets, meals, and progress.",
  "nutrition:write": "Estimate and log meals, and undo recent assistant meal saves.",
  "workouts:read": "Read your exercises, sets, reps, weights, duration, and workout history.",
  "workouts:write": "Log, correct, and remove your workout records.",
  "wellness:read": "Read your water log and body-weight history.",
  "wellness:write": "Record and correct your water and body weight.",
  "meals:read": "Read your saved meals and food entries for corrections.",
  "meals:write": "Save and log reusable meals, and correct or remove your food entries.",
  "sharing:read": "Read your accepted buddies' daily food and workout logs, their names, and meal proposals shared with you. Private profiles, water and body weights are excluded.",
  "sharing:write": "Send meals to your accepted buddies, and accept or decline meals shared with you.",
};
export const MCP_OPTIONAL_CAPABILITIES: ReadonlyArray<{ key: string; label: string; scopes: readonly McpScope[] }> = [
  { key: "workouts", label: "Workouts", scopes: ["workouts:read", "workouts:write"] },
  { key: "wellness", label: "Water and body weight", scopes: ["wellness:read", "wellness:write"] },
  { key: "meals", label: "Saved meals and corrections", scopes: ["meals:read", "meals:write"] },
  { key: "sharing", label: "Buddy logs and meal sharing", scopes: ["sharing:read", "sharing:write"] },
];
export function optionalConsentScopes(requested: readonly string[]): McpScope[] {
  return MCP_OPTIONAL_CAPABILITIES.flatMap(group => group.scopes).filter(scope => !requested.includes(scope));
}

export function allowedRedirectUris(): string[] {
  const redirects = ["https://claude.ai/api/mcp/auth_callback", ...(process.env.MCP_ALLOWED_REDIRECT_URIS ?? "").split(",").map(value => value.trim()).filter(Boolean)];
  for (const value of redirects) {
    const url = new URL(value);
    const local = process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password || url.hash) throw new Error("Invalid configured OAuth callback URL.");
  }
  return [...new Set(redirects)];
}
