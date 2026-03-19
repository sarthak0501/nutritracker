import { describe, it, expect, vi, beforeEach } from "vitest";
import { getBuddyId, getBuddyEntriesForDate, getBuddyInfo } from "@/lib/buddy";

vi.mock("@/lib/db", () => ({
  prisma: {
    buddyRelationship: {
      findFirst: vi.fn(),
    },
    logEntry: {
      findMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/db";

const mockPrisma = prisma as {
  buddyRelationship: { findFirst: ReturnType<typeof vi.fn> };
  logEntry: { findMany: ReturnType<typeof vi.fn> };
  user: { findUnique: ReturnType<typeof vi.fn> };
};

describe("getBuddyId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when no accepted relationship exists", async () => {
    mockPrisma.buddyRelationship.findFirst.mockResolvedValue(null);
    const result = await getBuddyId("user-1");
    expect(result).toBeNull();
  });

  it("queries with ACCEPTED status", async () => {
    mockPrisma.buddyRelationship.findFirst.mockResolvedValue(null);
    await getBuddyId("user-1");
    const query = mockPrisma.buddyRelationship.findFirst.mock.calls[0][0];
    expect(query.where.status).toBe("ACCEPTED");
  });

  it("returns addresseeId when user is the requester", async () => {
    mockPrisma.buddyRelationship.findFirst.mockResolvedValue({
      id: "rel-1",
      requesterId: "user-1",
      addresseeId: "user-2",
      status: "ACCEPTED",
    });
    const result = await getBuddyId("user-1");
    expect(result).toBe("user-2");
  });

  it("returns requesterId when user is the addressee", async () => {
    mockPrisma.buddyRelationship.findFirst.mockResolvedValue({
      id: "rel-1",
      requesterId: "user-2",
      addresseeId: "user-1",
      status: "ACCEPTED",
    });
    const result = await getBuddyId("user-1");
    expect(result).toBe("user-2");
  });

  it("searches both requester and addressee positions", async () => {
    mockPrisma.buddyRelationship.findFirst.mockResolvedValue(null);
    await getBuddyId("user-1");
    const query = mockPrisma.buddyRelationship.findFirst.mock.calls[0][0];
    expect(query.where.OR).toContainEqual({ requesterId: "user-1" });
    expect(query.where.OR).toContainEqual({ addresseeId: "user-1" });
  });
});

describe("getBuddyEntriesForDate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.logEntry.findMany.mockResolvedValue([]);
  });

  it("queries log entries for the given buddy and date", async () => {
    await getBuddyEntriesForDate("user-2", "2024-01-15");

    expect(mockPrisma.logEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-2", date: "2024-01-15" },
      })
    );
  });

  it("includes food and reactions with user info", async () => {
    await getBuddyEntriesForDate("user-2", "2024-01-15");
    const call = mockPrisma.logEntry.findMany.mock.calls[0][0];
    expect(call.include).toHaveProperty("food");
    expect(call.include).toHaveProperty("reactions");
  });

  it("returns an empty array when no entries found", async () => {
    const result = await getBuddyEntriesForDate("user-2", "2024-01-15");
    expect(result).toEqual([]);
  });

  it("returns entries when found", async () => {
    const entries = [{ id: "e1", date: "2024-01-15", userId: "user-2" }];
    mockPrisma.logEntry.findMany.mockResolvedValue(entries);
    const result = await getBuddyEntriesForDate("user-2", "2024-01-15");
    expect(result).toEqual(entries);
  });
});

describe("getBuddyInfo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns user info for a given buddyId", async () => {
    const user = { id: "user-2", username: "bob" };
    mockPrisma.user.findUnique.mockResolvedValue(user);

    const result = await getBuddyInfo("user-2");
    expect(result).toEqual(user);
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: "user-2" },
      select: { id: true, username: true },
    });
  });

  it("returns null when buddy is not found", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    const result = await getBuddyInfo("nonexistent");
    expect(result).toBeNull();
  });
});
