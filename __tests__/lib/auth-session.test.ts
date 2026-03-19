import { describe, it, expect, vi, beforeEach } from "vitest";
import { SignJWT, jwtVerify } from "jose";

const mockJar = vi.hoisted(() => ({
  set: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue(mockJar),
}));

import { createSession, getSession, deleteSession } from "@/lib/auth-session";

const SECRET = new TextEncoder().encode("fallback-secret-change-me");

async function signToken(payload: Record<string, unknown>, expiresIn = "30d") {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(expiresIn)
    .sign(SECRET);
}

describe("createSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets a cookie with the session token", async () => {
    await createSession({ id: "user-1", username: "alice" });

    expect(mockJar.set).toHaveBeenCalledOnce();
    const [cookieName, token, options] = mockJar.set.mock.calls[0];
    expect(cookieName).toBe("nt_session");
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe("lax");
    expect(options.path).toBe("/");
  });

  it("creates a verifiable JWT with correct claims", async () => {
    await createSession({ id: "user-1", username: "alice" });

    const token = mockJar.set.mock.calls[0][1];
    const { payload } = await jwtVerify(token, SECRET);
    expect(payload.id).toBe("user-1");
    expect(payload.username).toBe("alice");
  });

  it("sets maxAge to 30 days", async () => {
    await createSession({ id: "user-1", username: "alice" });
    const options = mockJar.set.mock.calls[0][2];
    expect(options.maxAge).toBe(60 * 60 * 24 * 30);
  });
});

describe("getSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when no cookie is set", async () => {
    mockJar.get.mockReturnValue(undefined);
    const result = await getSession();
    expect(result).toBeNull();
  });

  it("returns user when cookie has a valid token", async () => {
    const token = await signToken({ id: "user-1", username: "alice" });
    mockJar.get.mockReturnValue({ value: token });

    const result = await getSession();
    expect(result).toEqual({ id: "user-1", username: "alice" });
  });

  it("returns null for an invalid/tampered token", async () => {
    mockJar.get.mockReturnValue({ value: "this.is.not.a.valid.jwt" });
    const result = await getSession();
    expect(result).toBeNull();
  });

  it("returns null for an expired token", async () => {
    const token = await signToken({ id: "user-1", username: "alice" }, "-1s");
    mockJar.get.mockReturnValue({ value: token });
    const result = await getSession();
    expect(result).toBeNull();
  });

  it("returns null for an empty token string", async () => {
    mockJar.get.mockReturnValue({ value: "" });
    const result = await getSession();
    expect(result).toBeNull();
  });
});

describe("deleteSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes the session cookie", async () => {
    await deleteSession();
    expect(mockJar.delete).toHaveBeenCalledWith("nt_session");
  });
});
