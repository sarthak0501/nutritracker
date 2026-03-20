import type { Nutrients } from "./nutrition";

export type MealGrade = "A" | "B" | "C" | "D";

type Targets = {
  kcalTarget: number;
  proteinTarget: number;
  carbsTarget: number;
  fatTarget: number;
  fiberTarget: number | null;
};

/**
 * Grade a meal based on how well it fits within remaining daily goals.
 * Returns null if targets are not set.
 */
export function gradeMeal(
  mealNutrients: Nutrients,
  dayTotalsBefore: Nutrients,
  targets: Targets
): MealGrade {
  // How much budget was left before this meal
  const remainKcal = targets.kcalTarget - dayTotalsBefore.kcal;
  const remainProtein = targets.proteinTarget - dayTotalsBefore.protein_g;
  const remainCarbs = targets.carbsTarget - dayTotalsBefore.carbs_g;
  const remainFat = targets.fatTarget - dayTotalsBefore.fat_g;

  // After this meal
  const afterKcal = dayTotalsBefore.kcal + mealNutrients.kcal;
  const afterCarbs = dayTotalsBefore.carbs_g + mealNutrients.carbs_g;
  const afterFat = dayTotalsBefore.fat_g + mealNutrients.fat_g;

  // Score components (0-1 each)
  let score = 0;
  let factors = 0;

  // 1. Calorie fit: did this meal stay within remaining budget?
  if (remainKcal > 0) {
    const kcalRatio = mealNutrients.kcal / remainKcal;
    score += kcalRatio <= 0.5 ? 1 : kcalRatio <= 0.8 ? 0.75 : kcalRatio <= 1 ? 0.5 : 0.1;
  } else {
    // Already over budget before this meal
    score += 0;
  }
  factors++;

  // 2. Protein density: higher protein per calorie is better
  if (mealNutrients.kcal > 0) {
    const proteinPct = (mealNutrients.protein_g * 4) / mealNutrients.kcal;
    score += proteinPct >= 0.3 ? 1 : proteinPct >= 0.2 ? 0.75 : proteinPct >= 0.1 ? 0.5 : 0.25;
  }
  factors++;

  // 3. Max macros: did carbs/fat stay within limits?
  let overCount = 0;
  if (afterCarbs > targets.carbsTarget * 1.05) overCount++;
  if (afterFat > targets.fatTarget * 1.05) overCount++;
  if (afterKcal > targets.kcalTarget * 1.05) overCount++;
  score += overCount === 0 ? 1 : overCount === 1 ? 0.5 : 0;
  factors++;

  // 4. Protein progress: did it help hit protein target?
  if (remainProtein > 0 && mealNutrients.protein_g > 0) {
    const proteinProgress = mealNutrients.protein_g / remainProtein;
    score += proteinProgress >= 0.3 ? 1 : proteinProgress >= 0.15 ? 0.65 : 0.3;
  }
  factors++;

  const avg = score / factors;

  if (avg >= 0.75) return "A";
  if (avg >= 0.55) return "B";
  if (avg >= 0.35) return "C";
  return "D";
}

export function gradeColor(grade: MealGrade): string {
  switch (grade) {
    case "A": return "bg-green-100 text-green-700";
    case "B": return "bg-blue-100 text-blue-700";
    case "C": return "bg-amber-100 text-amber-700";
    case "D": return "bg-red-100 text-red-700";
  }
}
