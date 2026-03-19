import { describe, it, expect } from "vitest";
import {
  round1,
  round0,
  addNutrients,
  nutrientsForGrams,
  gramsForEntry,
  safeNutrientsForEntry,
  type Nutrients,
} from "@/lib/nutrition";
import type { Food, LogEntry } from "@prisma/client";

// Minimal Food stub
function makeFood(overrides: Partial<Food> = {}): Food {
  return {
    id: "food-1",
    name: "Test Food",
    brand: null,
    barcode: null,
    source: "MANUAL",
    kcalPer100g: 100,
    proteinPer100g: 10,
    carbsPer100g: 20,
    fatPer100g: 5,
    fiberPer100g: null,
    sodiumMgPer100g: null,
    servingGrams: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Food;
}

// Minimal LogEntry stub
function makeEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    id: "entry-1",
    userId: "user-1",
    foodId: "food-1",
    date: "2024-01-01",
    mealType: "BREAKFAST",
    mealName: null,
    amount: 100,
    unit: "GRAM",
    isEstimated: false,
    sourceText: null,
    estimationMeta: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as LogEntry;
}

describe("round1", () => {
  it("strips trailing .0 for whole numbers", () => {
    expect(round1(5.0)).toBe("5");
    expect(round1(100.0)).toBe("100");
    expect(round1(0.0)).toBe("0");
  });

  it("keeps one decimal for non-whole numbers", () => {
    expect(round1(5.55)).toBe("5.6");
    expect(round1(1.23)).toBe("1.2");
    expect(round1(9.99)).toBe("10");
  });

  it("rounds .05 up", () => {
    expect(round1(0.05)).toBe("0.1");
  });

  it("handles zero", () => {
    expect(round1(0)).toBe("0");
  });

  it("handles negative whole numbers", () => {
    expect(round1(-2.0)).toBe("-2");
    expect(round1(-10.0)).toBe("-10");
  });

  it("handles negative decimals", () => {
    expect(round1(-1.4)).toBe("-1.4");
    expect(round1(-1.5)).toBe("-1.5");
  });
});

describe("round0", () => {
  it("rounds to nearest integer", () => {
    expect(round0(5.4)).toBe("5");
    expect(round0(5.5)).toBe("6");
    expect(round0(100.9)).toBe("101");
  });

  it("handles zero", () => {
    expect(round0(0)).toBe("0");
  });

  it("handles already whole numbers", () => {
    expect(round0(42)).toBe("42");
  });
});

describe("addNutrients", () => {
  it("adds basic macros correctly", () => {
    const a: Nutrients = { kcal: 100, protein_g: 10, carbs_g: 20, fat_g: 5 };
    const b: Nutrients = { kcal: 200, protein_g: 20, carbs_g: 30, fat_g: 10 };
    const result = addNutrients(a, b);
    expect(result.kcal).toBe(300);
    expect(result.protein_g).toBe(30);
    expect(result.carbs_g).toBe(50);
    expect(result.fat_g).toBe(15);
  });

  it("treats missing fiber_g as 0", () => {
    const a: Nutrients = { kcal: 100, protein_g: 10, carbs_g: 20, fat_g: 5 };
    const b: Nutrients = { kcal: 100, protein_g: 10, carbs_g: 20, fat_g: 5, fiber_g: 3 };
    const result = addNutrients(a, b);
    expect(result.fiber_g).toBe(3);
  });

  it("adds fiber_g from both sides", () => {
    const a: Nutrients = { kcal: 100, protein_g: 10, carbs_g: 20, fat_g: 5, fiber_g: 2 };
    const b: Nutrients = { kcal: 100, protein_g: 10, carbs_g: 20, fat_g: 5, fiber_g: 3 };
    expect(addNutrients(a, b).fiber_g).toBe(5);
  });

  it("treats missing sodium_mg as 0", () => {
    const a: Nutrients = { kcal: 100, protein_g: 10, carbs_g: 20, fat_g: 5 };
    const b: Nutrients = { kcal: 100, protein_g: 10, carbs_g: 20, fat_g: 5, sodium_mg: 150 };
    expect(addNutrients(a, b).sodium_mg).toBe(150);
  });

  it("adds sodium from both sides", () => {
    const a: Nutrients = { kcal: 100, protein_g: 10, carbs_g: 20, fat_g: 5, sodium_mg: 100 };
    const b: Nutrients = { kcal: 100, protein_g: 10, carbs_g: 20, fat_g: 5, sodium_mg: 200 };
    expect(addNutrients(a, b).sodium_mg).toBe(300);
  });
});

describe("nutrientsForGrams", () => {
  it("scales correctly for 100g (factor=1)", () => {
    const food = makeFood({ kcalPer100g: 200, proteinPer100g: 15, carbsPer100g: 30, fatPer100g: 8 });
    const result = nutrientsForGrams(food, 100);
    expect(result.kcal).toBe(200);
    expect(result.protein_g).toBe(15);
    expect(result.carbs_g).toBe(30);
    expect(result.fat_g).toBe(8);
  });

  it("scales correctly for 200g (factor=2)", () => {
    const food = makeFood({ kcalPer100g: 200, proteinPer100g: 15, carbsPer100g: 30, fatPer100g: 8 });
    const result = nutrientsForGrams(food, 200);
    expect(result.kcal).toBe(400);
    expect(result.protein_g).toBe(30);
    expect(result.carbs_g).toBe(60);
    expect(result.fat_g).toBe(16);
  });

  it("scales correctly for 50g (factor=0.5)", () => {
    const food = makeFood({ kcalPer100g: 200, proteinPer100g: 10, carbsPer100g: 20, fatPer100g: 4 });
    const result = nutrientsForGrams(food, 50);
    expect(result.kcal).toBe(100);
    expect(result.protein_g).toBe(5);
  });

  it("returns undefined fiber when food has null fiber", () => {
    const food = makeFood({ fiberPer100g: null });
    expect(nutrientsForGrams(food, 100).fiber_g).toBeUndefined();
  });

  it("returns undefined sodium when food has null sodium", () => {
    const food = makeFood({ sodiumMgPer100g: null });
    expect(nutrientsForGrams(food, 100).sodium_mg).toBeUndefined();
  });

  it("scales fiber and sodium when present", () => {
    const food = makeFood({ fiberPer100g: 5, sodiumMgPer100g: 200 });
    const result = nutrientsForGrams(food, 50);
    expect(result.fiber_g).toBe(2.5);
    expect(result.sodium_mg).toBe(100);
  });

  it("handles 0 grams", () => {
    const food = makeFood({ kcalPer100g: 200 });
    expect(nutrientsForGrams(food, 0).kcal).toBe(0);
  });
});

describe("gramsForEntry", () => {
  it("returns amount directly for GRAM unit", () => {
    const entry = makeEntry({ amount: 150, unit: "GRAM" });
    const food = makeFood();
    expect(gramsForEntry(entry, food)).toBe(150);
  });

  it("converts SERVING to grams using servingGrams", () => {
    const entry = makeEntry({ amount: 2, unit: "SERVING" });
    const food = makeFood({ servingGrams: 30 });
    expect(gramsForEntry(entry, food)).toBe(60);
  });

  it("returns null for SERVING when servingGrams is null", () => {
    const entry = makeEntry({ amount: 1, unit: "SERVING" });
    const food = makeFood({ servingGrams: null });
    expect(gramsForEntry(entry, food)).toBeNull();
  });

  it("handles fractional servings", () => {
    const entry = makeEntry({ amount: 0.5, unit: "SERVING" });
    const food = makeFood({ servingGrams: 100 });
    expect(gramsForEntry(entry, food)).toBe(50);
  });
});

describe("safeNutrientsForEntry", () => {
  it("returns nutrients for valid GRAM entry", () => {
    const food = makeFood({ kcalPer100g: 400, proteinPer100g: 20, carbsPer100g: 50, fatPer100g: 10 });
    const entry = makeEntry({ amount: 100, unit: "GRAM" });
    const result = safeNutrientsForEntry(entry, food);
    expect(result).not.toBeNull();
    expect(result!.kcal).toBe(400);
  });

  it("returns nutrients for valid SERVING entry", () => {
    const food = makeFood({ kcalPer100g: 200, proteinPer100g: 10, carbsPer100g: 20, fatPer100g: 5, servingGrams: 50 });
    const entry = makeEntry({ amount: 1, unit: "SERVING" });
    const result = safeNutrientsForEntry(entry, food);
    expect(result).not.toBeNull();
    expect(result!.kcal).toBe(100);
  });

  it("returns null for SERVING with no servingGrams", () => {
    const food = makeFood({ servingGrams: null });
    const entry = makeEntry({ amount: 1, unit: "SERVING" });
    expect(safeNutrientsForEntry(entry, food)).toBeNull();
  });

  it("returns null for zero grams", () => {
    const food = makeFood();
    const entry = makeEntry({ amount: 0, unit: "GRAM" });
    expect(safeNutrientsForEntry(entry, food)).toBeNull();
  });

  it("returns null for negative grams", () => {
    const food = makeFood();
    const entry = makeEntry({ amount: -10, unit: "GRAM" });
    expect(safeNutrientsForEntry(entry, food)).toBeNull();
  });
});
