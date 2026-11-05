import { SignJWT } from "jose";
import { cookies } from "next/headers";
import { getSessionSecret, verifySessionToken, type SessionUser } from "@/lib/auth-token";
export type { SessionUser } from "@/lib/auth-token";

const COOKIE = "nt_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export async function createSession(user: SessionUser) {
  const token = await new SignJWT({ id: user.id, username: user.username })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("30d")
    .sign(getSessionSecret());

  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: MAX_AGE,
    path: "/",
  });
}

export async function getSession(): Promise<SessionUser | null> {
  try {
    const jar = await cookies();
    const token = jar.get(COOKIE)?.value;
    if (!token) return null;
    return verifySessionToken(token);
  } catch {
    return null;
  }
}

export async function deleteSession() {
  const jar = await cookies();
  jar.delete(COOKIE);
}
