import { describe, it, expect, vi, beforeEach } from "vitest";
import { sendBuddyRequest, respondToBuddyRequest, removeBuddy } from "@/app/actions/buddy";

vi.mock("@/lib/session", () => ({
  requireSession: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    buddyRelationship: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";

const mockRequireSession = requireSession as ReturnType<typeof vi.fn>;
const mockPrisma = prisma as {
  user: { findUnique: ReturnType<typeof vi.fn> };
  buddyRelationship: {
    findFirst: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
};
const mockRevalidatePath = revalidatePath as ReturnType<typeof vi.fn>;

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

const SESSION_USER = { id: "user-1", name: "alice" };

describe("sendBuddyRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireSession.mockResolvedValue(SESSION_USER);
    mockPrisma.user.findUnique.mockResolvedValue({ id: "user-2", username: "bob" });
    mockPrisma.buddyRelationship.findFirst.mockResolvedValue(null);
    mockPrisma.buddyRelationship.create.mockResolvedValue({});
  });

  it("creates a buddy request when no relationship exists", async () => {
    const fd = makeFormData({ username: "bob" });
    await sendBuddyRequest(fd);

    expect(mockPrisma.buddyRelationship.create).toHaveBeenCalledWith({
      data: { requesterId: "user-1", addresseeId: "user-2", status: "PENDING" },
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/buddy");
  });

  it("does nothing when username is empty", async () => {
    const fd = makeFormData({ username: "" });
    await sendBuddyRequest(fd);
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.buddyRelationship.create).not.toHaveBeenCalled();
  });

  it("does nothing when target user is not found", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    const fd = makeFormData({ username: "ghost" });
    await sendBuddyRequest(fd);
    expect(mockPrisma.buddyRelationship.create).not.toHaveBeenCalled();
  });

  it("prevents sending request to self", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: "user-1", username: "alice" });
    const fd = makeFormData({ username: "alice" });
    await sendBuddyRequest(fd);
    expect(mockPrisma.buddyRelationship.create).not.toHaveBeenCalled();
  });

  it("does not create duplicate relationship", async () => {
    mockPrisma.buddyRelationship.findFirst.mockResolvedValue({ id: "rel-1", status: "PENDING" });
    const fd = makeFormData({ username: "bob" });
    await sendBuddyRequest(fd);
    expect(mockPrisma.buddyRelationship.create).not.toHaveBeenCalled();
  });
});

describe("respondToBuddyRequest", () => {
  const RELATIONSHIP = { id: "rel-1", requesterId: "user-2", addresseeId: "user-1", status: "PENDING" };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireSession.mockResolvedValue(SESSION_USER);
    mockPrisma.buddyRelationship.findUnique.mockResolvedValue(RELATIONSHIP);
    mockPrisma.buddyRelationship.update.mockResolvedValue({});
    mockPrisma.buddyRelationship.delete.mockResolvedValue({});
  });

  it("accepts a buddy request", async () => {
    const fd = makeFormData({ id: "rel-1", action: "accept" });
    await respondToBuddyRequest(fd);

    expect(mockPrisma.buddyRelationship.update).toHaveBeenCalledWith({
      where: { id: "rel-1" },
      data: { status: "ACCEPTED" },
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/buddy");
  });

  it("declines (deletes) a buddy request", async () => {
    const fd = makeFormData({ id: "rel-1", action: "decline" });
    await respondToBuddyRequest(fd);

    expect(mockPrisma.buddyRelationship.delete).toHaveBeenCalledWith({ where: { id: "rel-1" } });
    expect(mockPrisma.buddyRelationship.update).not.toHaveBeenCalled();
  });

  it("does nothing when relationship is not found", async () => {
    mockPrisma.buddyRelationship.findUnique.mockResolvedValue(null);
    const fd = makeFormData({ id: "nonexistent", action: "accept" });
    await respondToBuddyRequest(fd);
    expect(mockPrisma.buddyRelationship.update).not.toHaveBeenCalled();
  });

  it("prevents responding to requests not addressed to current user", async () => {
    // Relationship was sent TO user-3, not user-1
    mockPrisma.buddyRelationship.findUnique.mockResolvedValue({
      id: "rel-1",
      requesterId: "user-2",
      addresseeId: "user-3",
    });
    const fd = makeFormData({ id: "rel-1", action: "accept" });
    await respondToBuddyRequest(fd);
    expect(mockPrisma.buddyRelationship.update).not.toHaveBeenCalled();
  });
});

describe("removeBuddy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireSession.mockResolvedValue(SESSION_USER);
    mockPrisma.buddyRelationship.delete.mockResolvedValue({});
  });

  it("removes buddy when user is the requester", async () => {
    mockPrisma.buddyRelationship.findUnique.mockResolvedValue({
      id: "rel-1",
      requesterId: "user-1",
      addresseeId: "user-2",
    });
    const fd = makeFormData({ id: "rel-1" });
    await removeBuddy(fd);
    expect(mockPrisma.buddyRelationship.delete).toHaveBeenCalledWith({ where: { id: "rel-1" } });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/buddy");
  });

  it("removes buddy when user is the addressee", async () => {
    mockPrisma.buddyRelationship.findUnique.mockResolvedValue({
      id: "rel-1",
      requesterId: "user-2",
      addresseeId: "user-1",
    });
    const fd = makeFormData({ id: "rel-1" });
    await removeBuddy(fd);
    expect(mockPrisma.buddyRelationship.delete).toHaveBeenCalled();
  });

  it("does nothing when relationship not found", async () => {
    mockPrisma.buddyRelationship.findUnique.mockResolvedValue(null);
    const fd = makeFormData({ id: "nonexistent" });
    await removeBuddy(fd);
    expect(mockPrisma.buddyRelationship.delete).not.toHaveBeenCalled();
  });

  it("prevents removing a relationship the user is not part of", async () => {
    mockPrisma.buddyRelationship.findUnique.mockResolvedValue({
      id: "rel-1",
      requesterId: "user-2",
      addresseeId: "user-3",
    });
    const fd = makeFormData({ id: "rel-1" });
    await removeBuddy(fd);
    expect(mockPrisma.buddyRelationship.delete).not.toHaveBeenCalled();
  });
});
