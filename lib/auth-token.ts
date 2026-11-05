import { jwtVerify } from "jose";

export type SessionUser = { id: string; username: string };

export function getSessionSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET environment variable is not set.");
  return new TextEncoder().encode(secret);
}

/** Shared by middleware and server pages; never accept other JWTs as sessions. */
export async function verifySessionToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, getSessionSecret(), { algorithms: ["HS256"] });
    if (typeof payload.id !== "string" || !payload.id.trim() || typeof payload.username !== "string" || !payload.username.trim() || typeof payload.exp !== "number") return null;
    return { id: payload.id, username: payload.username };
  } catch { return null; }
}
