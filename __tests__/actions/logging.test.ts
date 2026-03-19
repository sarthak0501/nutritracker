import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createManualFoodAndLogEntry,
  createLogEntryFromExistingFood,
  deleteLogEntry,
  applyEstimatedMeal,
} from "@/app/actions/logging";
import type { EstimateResponse } from "@/lib/llm";

vi.mock("@/lib/db", () => ({
  prisma: {
    food: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    logEntry: {
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/session", () => ({
  requireSession: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { prisma } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { revalidatePath } from "next/cache";

const mockPrisma = prisma as {
  food: { create: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> };
  logEntry: { create: ReturnType<typeof vi.fn>; deleteMany: ReturnType<typeof vi.fn> };
};
const mockRequireSession = requireSession as ReturnType<typeof vi.fn>;
const mockRevalidatePath = revalidatePath as ReturnType<typeof vi.fn>;

const SESSION_USER = { id: "user-1", name: "alice" };

function makeFormData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    fd.append(k, v);
  }
  return fd;
}

const VALID_MANUAL_FIELDS = {
  date: "2024-01-15",
  mealType: "BREAKFAST",
  amount: "100",
  unit: "GRAM",
  name: "Oatmeal",
  kcalPer100g: "350",
  proteinPer100g: "12",
  carbsPer100g: "60",
  fatPer100g: "7",
};

describe("createManualFoodAndLogEntry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireSession.mockResolvedValue(SESSION_USER);
    mockPrisma.food.create.mockResolvedValue({ id: "food-1" });
    mockPrisma.logEntry.create.mockResolvedValue({});
  });

  it("creates food and log entry with valid data", async () => {
    const fd = makeFormData(VALID_MANUAL_FIELDS);
    await createManualFoodAndLogEntry(fd);

    expect(mockPrisma.food.create).toHaveBeenCalledOnce();
    expect(mockPrisma.logEntry.create).toHaveBeenCalledOnce();

    const foodData = mockPrisma.food.create.mock.calls[0][0].data;
    expect(foodData.name).toBe("Oatmeal");
    expect(foodData.source).toBe("MANUAL");
    expect(foodData.kcalPer100g).toBe(350);
  });

  it("throws on invalid date format", async () => {
    const fd = makeFormData({ ...VALID_MANUAL_FIELDS, date: "01-15-2024" });
    await expect(createManualFoodAndLogEntry(fd)).rejects.toThrow("Invalid form data");
  });

  it("throws on invalid mealType", async () => {
    const fd = makeFormData({ ...VALID_MANUAL_FIELDS, mealType: "SUPPER" });
    await expect(createManualFoodAndLogEntry(fd)).rejects.toThrow("Invalid form data");
  });

  it("throws on negative amount", async () => {
    const fd = makeFormData({ ...VALID_MANUAL_FIELDS, amount: "-10" });
    await expect(createManualFoodAndLogEntry(fd)).rejects.toThrow("Invalid form data");
  });

  it("throws when nutrition fields are missing", async () => {
    const { kcalPer100g: _k, ...rest } = VALID_MANUAL_FIELDS;
    const fd = makeFormData(rest);
    await expect(createManualFoodAndLogEntry(fd)).rejects.toThrow("Missing required nutrition fields");
  });

  it("passes optional fiber and sodium when provided", async () => {
    const fd = makeFormData({ ...VALID_MANUAL_FIELDS, fiberPer100g: "5", sodiumMgPer100g: "200" });
    await createManualFoodAndLogEntry(fd);
    const foodData = mockPrisma.food.create.mock.calls[0][0].data;
    expect(foodData.fiberPer100g).toBe(5);
    expect(foodData.sodiumMgPer100g).toBe(200);
  });

  it("revalidates correct paths", async () => {
    const fd = makeFormData(VALID_MANUAL_FIELDS);
    await createManualFoodAndLogEntry(fd);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/history");
  });
});

describe("createLogEntryFromExistingFood", () => {
  const EXISTING_FOOD = { id: "food-existing", name: "Banana", kcalPer100g: 89 };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireSession.mockResolvedValue(SESSION_USER);
    mockPrisma.food.findUnique.mockResolvedValue(EXISTING_FOOD);
    mockPrisma.logEntry.create.mockResolvedValue({});
  });

  it("creates log entry for existing food", async () => {
    const fd = makeFormData({
      date: "2024-01-15",
      mealType: "LUNCH",
      amount: "150",
      unit: "GRAM",
      foodId: "food-existing",
    });
    await createLogEntryFromExistingFood(fd);

    expect(mockPrisma.food.findUnique).toHaveBeenCalledWith({ where: { id: "food-existing" } });
    expect(mockPrisma.logEntry.create).toHaveBeenCalledOnce();

    const entryData = mockPrisma.logEntry.create.mock.calls[0][0].data;
    expect(entryData.userId).toBe("user-1");
    expect(entryData.amount).toBe(150);
    expect(entryData.isEstimated).toBe(false);
  });

  it("throws when foodId is missing", async () => {
    const fd = makeFormData({
      date: "2024-01-15",
      mealType: "LUNCH",
      amount: "150",
      unit: "GRAM",
    });
    await expect(createLogEntryFromExistingFood(fd)).rejects.toThrow("Missing foodId");
  });

  it("throws when food is not found", async () => {
    mockPrisma.food.findUnique.mockResolvedValue(null);
    const fd = makeFormData({
      date: "2024-01-15",
      mealType: "LUNCH",
      amount: "150",
      unit: "GRAM",
      foodId: "nonexistent",
    });
    await expect(createLogEntryFromExistingFood(fd)).rejects.toThrow("Food not found");
  });

  it("throws on invalid unit", async () => {
    const fd = makeFormData({
      date: "2024-01-15",
      mealType: "LUNCH",
      amount: "150",
      unit: "TABLESPOON",
      foodId: "food-existing",
    });
    await expect(createLogEntryFromExistingFood(fd)).rejects.toThrow("Invalid form data");
  });
});

describe("deleteLogEntry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireSession.mockResolvedValue(SESSION_USER);
    mockPrisma.logEntry.deleteMany.mockResolvedValue({ count: 1 });
  });

  it("deletes entry scoped to current user", async () => {
    const fd = makeFormData({ id: "entry-1" });
    await deleteLogEntry(fd);

    expect(mockPrisma.logEntry.deleteMany).toHaveBeenCalledWith({
      where: { id: "entry-1", userId: "user-1" },
    });
  });

  it("throws when id is missing", async () => {
    const fd = makeFormData({});
    await expect(deleteLogEntry(fd)).rejects.toThrow("Missing id");
  });

  it("revalidates paths after delete", async () => {
    const fd = makeFormData({ id: "entry-1" });
    await deleteLogEntry(fd);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/history");
  });
});

describe("applyEstimatedMeal", () => {
  const ESTIMATE: EstimateResponse = {
    items: [
      {
        description: "Grilled Chicken",
        quantity: 150,
        unit: "grams",
        assumptions: ["boneless breast"],
        nutrients: { kcal: 247.5, protein_g: 46.5, carbs_g: 0, fat_g: 5.4, fiber_g: 0, sodium_mg: 111 },
        confidence: 0.9,
      },
      {
        description: "Brown Rice",
        quantity: 100,
        unit: "grams",
        assumptions: ["cooked"],
        nutrients: { kcal: 216, protein_g: 4.5, carbs_g: 45, fat_g: 1.8 },
        confidence: 0.85,
      },
    ],
    notes: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireSession.mockResolvedValue(SESSION_USER);
    mockPrisma.food.create.mockResolvedValue({ id: "food-llm" });
    mockPrisma.logEntry.create.mockResolvedValue({});
  });

  it("creates food and log entry for each estimated item", async () => {
    await applyEstimatedMeal({
      date: "2024-01-15",
      mealType: "DINNER",
      estimate: ESTIMATE,
      sourceText: "chicken and rice",
    });

    expect(mockPrisma.food.create).toHaveBeenCalledTimes(2);
    expect(mockPrisma.logEntry.create).toHaveBeenCalledTimes(2);
  });

  it("creates foods with LLM source", async () => {
    await applyEstimatedMeal({
      date: "2024-01-15",
      mealType: "DINNER",
      estimate: ESTIMATE,
      sourceText: "chicken and rice",
    });

    const firstFoodData = mockPrisma.food.create.mock.calls[0][0].data;
    expect(firstFoodData.source).toBe("LLM");
    expect(firstFoodData.name).toBe("Grilled Chicken");
  });

  it("converts item nutrients to per-100g basis", async () => {
    await applyEstimatedMeal({
      date: "2024-01-15",
      mealType: "DINNER",
      estimate: ESTIMATE,
      sourceText: "test",
    });

    const firstFoodData = mockPrisma.food.create.mock.calls[0][0].data;
    // Item has 247.5 kcal for 150g → 165 kcal per 100g
    expect(firstFoodData.kcalPer100g).toBeCloseTo(165, 1);
  });

  it("marks log entries as estimated", async () => {
    await applyEstimatedMeal({
      date: "2024-01-15",
      mealType: "DINNER",
      estimate: ESTIMATE,
      sourceText: "chicken and rice",
    });

    const entryData = mockPrisma.logEntry.create.mock.calls[0][0].data;
    expect(entryData.isEstimated).toBe(true);
    expect(entryData.sourceText).toBe("chicken and rice");
  });

  it("stores confidence and assumptions in estimationMeta", async () => {
    await applyEstimatedMeal({
      date: "2024-01-15",
      mealType: "LUNCH",
      estimate: ESTIMATE,
      sourceText: "meal",
    });

    const entryData = mockPrisma.logEntry.create.mock.calls[0][0].data;
    expect(entryData.estimationMeta.confidence).toBe(0.9);
    expect(entryData.estimationMeta.assumptions).toEqual(["boneless breast"]);
  });

  it("revalidates paths", async () => {
    await applyEstimatedMeal({
      date: "2024-01-15",
      mealType: "LUNCH",
      estimate: { items: [], notes: [] },
      sourceText: "empty",
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/history");
  });
});
