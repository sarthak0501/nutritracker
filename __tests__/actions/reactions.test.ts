import { describe, it, expect, vi, beforeEach } from "vitest";
import { toggleReaction } from "@/app/actions/reactions";

vi.mock("@/lib/session", () => ({
  requireSession: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    logEntry: { findUnique: vi.fn() },
    reaction: {
      findUnique: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock("@/lib/buddy", () => ({
  getBuddyId: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { getBuddyId } from "@/lib/buddy";
import { revalidatePath } from "next/cache";

const mockRequireSession = requireSession as ReturnType<typeof vi.fn>;
const mockPrisma = prisma as {
  logEntry: { findUnique: ReturnType<typeof vi.fn> };
  reaction: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
};
const mockGetBuddyId = getBuddyId as ReturnType<typeof vi.fn>;
const mockRevalidatePath = revalidatePath as ReturnType<typeof vi.fn>;

const SESSION_USER = { id: "user-1", name: "alice" };

describe("toggleReaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireSession.mockResolvedValue(SESSION_USER);
    mockPrisma.logEntry.findUnique.mockResolvedValue({ userId: "user-2" });
    mockGetBuddyId.mockResolvedValue("user-2");
    mockPrisma.reaction.findUnique.mockResolvedValue(null);
    mockPrisma.reaction.create.mockResolvedValue({});
    mockPrisma.reaction.delete.mockResolvedValue({});
  });

  it("creates a reaction when one does not exist", async () => {
    await toggleReaction("entry-1", "THUMBS_UP");

    expect(mockPrisma.reaction.create).toHaveBeenCalledWith({
      data: { logEntryId: "entry-1", userId: "user-1", type: "THUMBS_UP" },
    });
    expect(mockPrisma.reaction.delete).not.toHaveBeenCalled();
  });

  it("deletes an existing reaction (toggle off)", async () => {
    mockPrisma.reaction.findUnique.mockResolvedValue({ id: "reaction-1", type: "FIRE" });

    await toggleReaction("entry-1", "FIRE");

    expect(mockPrisma.reaction.delete).toHaveBeenCalledWith({ where: { id: "reaction-1" } });
    expect(mockPrisma.reaction.create).not.toHaveBeenCalled();
  });

  it("revalidates paths after toggling", async () => {
    await toggleReaction("entry-1", "MUSCLE");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/history");
  });

  it("throws when entry is not found", async () => {
    mockPrisma.logEntry.findUnique.mockResolvedValue(null);
    await expect(toggleReaction("nonexistent", "THUMBS_UP")).rejects.toThrow("Entry not found");
  });

  it("throws when user has no buddy", async () => {
    mockGetBuddyId.mockResolvedValue(null);
    await expect(toggleReaction("entry-1", "THUMBS_UP")).rejects.toThrow("Not your buddy's entry");
  });

  it("throws when entry belongs to someone other than buddy", async () => {
    mockPrisma.logEntry.findUnique.mockResolvedValue({ userId: "user-3" });
    mockGetBuddyId.mockResolvedValue("user-2");
    await expect(toggleReaction("entry-1", "THUMBS_UP")).rejects.toThrow("Not your buddy's entry");
  });

  it("throws on invalid reaction type", async () => {
    await expect(toggleReaction("entry-1", "INVALID_TYPE")).rejects.toThrow();
  });

  it("uses correct unique key for reaction lookup", async () => {
    await toggleReaction("entry-1", "THUMBS_DOWN");

    expect(mockPrisma.reaction.findUnique).toHaveBeenCalledWith({
      where: {
        logEntryId_userId_type: {
          logEntryId: "entry-1",
          userId: "user-1",
          type: "THUMBS_DOWN",
        },
      },
    });
  });

  it("supports all valid reaction types", async () => {
    for (const type of ["THUMBS_UP", "THUMBS_DOWN", "FIRE", "MUSCLE"]) {
      vi.clearAllMocks();
      mockRequireSession.mockResolvedValue(SESSION_USER);
      mockPrisma.logEntry.findUnique.mockResolvedValue({ userId: "user-2" });
      mockGetBuddyId.mockResolvedValue("user-2");
      mockPrisma.reaction.findUnique.mockResolvedValue(null);
      mockPrisma.reaction.create.mockResolvedValue({});

      await expect(toggleReaction("entry-1", type)).resolves.not.toThrow();
    }
  });
});
