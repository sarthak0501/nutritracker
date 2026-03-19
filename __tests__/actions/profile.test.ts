import { describe, it, expect, vi, beforeEach } from "vitest";
import { updateProfile, updateBodyStats } from "@/app/actions/profile";

vi.mock("@/lib/session", () => ({
  requireSession: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    profile: { upsert: vi.fn() },
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";

const mockRequireSession = requireSession as ReturnType<typeof vi.fn>;
const mockPrisma = prisma as { profile: { upsert: ReturnType<typeof vi.fn> } };
const mockRevalidatePath = revalidatePath as ReturnType<typeof vi.fn>;

const SESSION_USER = { id: "user-1", name: "alice" };

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}

describe("updateProfile", () => {
  const VALID_PROFILE = {
    kcalTarget: "2000",
    proteinTarget: "150",
    carbsTarget: "200",
    fatTarget: "70",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireSession.mockResolvedValue(SESSION_USER);
    mockPrisma.profile.upsert.mockResolvedValue({});
  });

  it("upserts profile with valid data", async () => {
    const fd = makeFormData(VALID_PROFILE);
    await updateProfile(fd);

    expect(mockPrisma.profile.upsert).toHaveBeenCalledOnce();
    const call = mockPrisma.profile.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ userId: "user-1" });
    expect(call.update.kcalTarget).toBe(2000);
    expect(call.update.proteinTarget).toBe(150);
  });

  it("does nothing when kcalTarget is below minimum", async () => {
    const fd = makeFormData({ ...VALID_PROFILE, kcalTarget: "400" });
    await updateProfile(fd);
    expect(mockPrisma.profile.upsert).not.toHaveBeenCalled();
  });

  it("does nothing when kcalTarget is above maximum", async () => {
    const fd = makeFormData({ ...VALID_PROFILE, kcalTarget: "15000" });
    await updateProfile(fd);
    expect(mockPrisma.profile.upsert).not.toHaveBeenCalled();
  });

  it("does nothing when proteinTarget is negative", async () => {
    const fd = makeFormData({ ...VALID_PROFILE, proteinTarget: "-10" });
    await updateProfile(fd);
    expect(mockPrisma.profile.upsert).not.toHaveBeenCalled();
  });

  it("includes optional fiberTarget when provided", async () => {
    const fd = makeFormData({ ...VALID_PROFILE, fiberTarget: "30" });
    await updateProfile(fd);
    const call = mockPrisma.profile.upsert.mock.calls[0][0];
    expect(call.update.fiberTarget).toBe(30);
  });

  it("omits fiberTarget when not provided", async () => {
    const fd = makeFormData(VALID_PROFILE);
    await updateProfile(fd);
    const call = mockPrisma.profile.upsert.mock.calls[0][0];
    expect(call.update.fiberTarget).toBeUndefined();
  });

  it("revalidates correct paths", async () => {
    const fd = makeFormData(VALID_PROFILE);
    await updateProfile(fd);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/profile");
  });
});

describe("updateBodyStats", () => {
  const VALID_STATS = {
    heightCm: "175",
    weightKg: "70",
    age: "30",
    gender: "male",
    equipmentPreset: "gym",
    equipment: "",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireSession.mockResolvedValue(SESSION_USER);
    mockPrisma.profile.upsert.mockResolvedValue({});
  });

  it("upserts body stats with valid data", async () => {
    const fd = makeFormData(VALID_STATS);
    await updateBodyStats(fd);

    expect(mockPrisma.profile.upsert).toHaveBeenCalledOnce();
    const call = mockPrisma.profile.upsert.mock.calls[0][0];
    expect(call.update.heightCm).toBe(175);
    expect(call.update.weightKg).toBe(70);
    expect(call.update.age).toBe(30);
  });

  it("does nothing when height is below minimum", async () => {
    const fd = makeFormData({ ...VALID_STATS, heightCm: "30" });
    await updateBodyStats(fd);
    expect(mockPrisma.profile.upsert).not.toHaveBeenCalled();
  });

  it("does nothing when weight is above maximum", async () => {
    const fd = makeFormData({ ...VALID_STATS, weightKg: "600" });
    await updateBodyStats(fd);
    expect(mockPrisma.profile.upsert).not.toHaveBeenCalled();
  });

  it("parses comma-separated equipment string into array", async () => {
    const fd = makeFormData({ ...VALID_STATS, equipmentPreset: "", equipment: "barbell, dumbbells, pull-up bar" });
    await updateBodyStats(fd);
    const call = mockPrisma.profile.upsert.mock.calls[0][0];
    expect(call.update.equipment).toEqual(["barbell", "dumbbells", "pull-up bar"]);
  });

  it("defaults equipment to empty array when not provided", async () => {
    const fd = makeFormData({ ...VALID_STATS, equipment: "" });
    await updateBodyStats(fd);
    const call = mockPrisma.profile.upsert.mock.calls[0][0];
    expect(call.update.equipment).toEqual([]);
  });

  it("omits optional fields when not provided", async () => {
    const fd = makeFormData({ equipment: "" });
    await updateBodyStats(fd);
    const call = mockPrisma.profile.upsert.mock.calls[0][0];
    expect(call.update.heightCm).toBeUndefined();
    expect(call.update.weightKg).toBeUndefined();
    expect(call.update.age).toBeUndefined();
  });

  it("revalidates workouts path along with other paths", async () => {
    const fd = makeFormData(VALID_STATS);
    await updateBodyStats(fd);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/workouts");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/profile");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/");
  });
});
