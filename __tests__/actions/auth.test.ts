import { describe, it, expect, vi, beforeEach } from "vitest";
import { loginAction, logoutAction } from "@/app/actions/auth";

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("bcryptjs", () => ({
  default: {
    compare: vi.fn(),
  },
}));

vi.mock("@/lib/auth-session", () => ({
  createSession: vi.fn(),
  deleteSession: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

import { prisma } from "@/lib/db";
import bcrypt from "bcryptjs";
import { createSession, deleteSession } from "@/lib/auth-session";
import { redirect } from "next/navigation";

const mockPrisma = prisma as { user: { findUnique: ReturnType<typeof vi.fn> } };
const mockBcrypt = bcrypt as { compare: ReturnType<typeof vi.fn> };
const mockCreateSession = createSession as ReturnType<typeof vi.fn>;
const mockDeleteSession = deleteSession as ReturnType<typeof vi.fn>;
const mockRedirect = redirect as ReturnType<typeof vi.fn>;

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    fd.append(k, v);
  }
  return fd;
}

describe("loginAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns error when username is missing", async () => {
    const fd = makeFormData({ password: "secret" });
    const result = await loginAction(null, fd);
    expect(result).toBe("Please enter username and password");
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("returns error when password is missing", async () => {
    const fd = makeFormData({ username: "alice" });
    const result = await loginAction(null, fd);
    expect(result).toBe("Please enter username and password");
  });

  it("returns error when both fields are missing", async () => {
    const fd = makeFormData({});
    const result = await loginAction(null, fd);
    expect(result).toBe("Please enter username and password");
  });

  it("returns error when user is not found", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    const fd = makeFormData({ username: "ghost", password: "secret" });
    const result = await loginAction(null, fd);
    expect(result).toBe("Invalid username or password");
    expect(mockBcrypt.compare).not.toHaveBeenCalled();
  });

  it("returns error when password is wrong", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: "1", username: "alice", passwordHash: "hash" });
    mockBcrypt.compare.mockResolvedValue(false);
    const fd = makeFormData({ username: "alice", password: "wrong" });
    const result = await loginAction(null, fd);
    expect(result).toBe("Invalid username or password");
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it("creates session and redirects on successful login", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: "user-1", username: "alice", passwordHash: "hash" });
    mockBcrypt.compare.mockResolvedValue(true);
    const fd = makeFormData({ username: "alice", password: "correct" });
    await loginAction(null, fd);
    expect(mockCreateSession).toHaveBeenCalledWith({ id: "user-1", username: "alice" });
    expect(mockRedirect).toHaveBeenCalledWith("/");
  });

  it("trims whitespace from username", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    const fd = makeFormData({ username: "  alice  ", password: "pw" });
    await loginAction(null, fd);
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({ where: { username: "alice" } });
  });
});

describe("logoutAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes session and redirects to login", async () => {
    await logoutAction();
    expect(mockDeleteSession).toHaveBeenCalledOnce();
    expect(mockRedirect).toHaveBeenCalledWith("/login");
  });
});
