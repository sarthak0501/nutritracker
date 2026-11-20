import { createHmac, randomUUID } from "node:crypto";
import { MealType, type Prisma } from "@prisma/client";
import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import type { EstimateResponse } from "@/lib/llm";
import type { StoredMealItem } from "@/lib/meal-library";
import { mealDateSchema } from "@/lib/meal-writes";
import { McpMutationError } from "@/lib/mcp-mutations";

const quantity = z.number().finite().positive().max(1_000_000);
const nutrient = z.number().finite().nonnegative().max(1_000_000);
const nutrientsSchema = z.object({
  kcal: nutrient, protein_g: nutrient, carbs_g: nutrient, fat_g: nutrient, fiber_g: nutrient.nullable(),
}).strict();
const suppliedNutrients = nutrientsSchema.partial().describe("Only facts supplied by the person or their label. Omit unknown nutrients. A known zero is valid.");
const labelFields = {
  nutrients: suppliedNutrients,
  estimateMissingFromIngredients: z.boolean().optional().describe("True only when the person wants missing core nutrients estimated from the whole recipe's stated ingredients. Known facts are preserved."),
};
const yieldSchema = z.object({ amount: quantity, unit: z.enum(["servings", "grams"]) }).strict();
export const RecipeInputSchema = z.object({
  yield: yieldSchema.describe("The actual yield of the whole cooked dish in equal servings or measured cooked grams. Ask for it if unknown."),
  nutrition: z.discriminatedUnion("basis", [
    z.object({ basis: z.literal("whole_recipe"), ...labelFields }).strict(),
    z.object({ basis: z.literal("per_serving"), ...labelFields,
      servingGrams: quantity.optional().describe("Required if cooked yield is in grams. Supply the measured grams in one labeled serving.") }).strict(),
    z.object({ basis: z.literal("ingredients") }).strict(),
  ]),
}).strict();

const recipeItemSchema = z.object({
  id: z.string().max(100), name: z.string().trim().min(1).max(200), amount: quantity,
  unit: z.enum(["SERVING", "GRAM"]), nutrients: nutrientsSchema, isEstimated: z.boolean(),
}).strict();
const coreNutrients = ["kcal", "protein_g", "carbs_g", "fat_g"] as const;
const nutrientNames = [...coreNutrients, "fiber_g"] as const;
const recipeSchema = z.object({
  date: mealDateSchema, mealType: z.nativeEnum(MealType), mealName: z.string().trim().min(1).max(200),
  yield: yieldSchema, items: z.array(recipeItemSchema).length(1), isEstimated: z.boolean(),
  estimatedNutrients: z.array(z.enum(nutrientNames)).max(nutrientNames.length),
}).strict();
const tokenIssuer = "nutritracker:prepared-recipe";
const tokenAudience = "nutritracker:mcp:portion-recipe";
const tokenType = "nt-prepared-recipe+jwt";
const lifetimeSeconds = 30 * 60;
export const preparedRecipeTokenSchema = z.string().min(1).max(16_384);
const signedSchema = z.object({
  iss: z.literal(tokenIssuer), aud: z.literal(tokenAudience), sub: z.string().min(1).max(200),
  jti: z.string().uuid(), iat: z.number().int().positive(), exp: z.number().int().positive(), recipe: recipeSchema,
}).strict();
type RecipeInput = z.infer<typeof RecipeInputSchema>;
export type VerifiedRecipe = z.infer<typeof recipeSchema> & { id: string; actorId: string };
type RecipeNutrients = z.infer<typeof nutrientsSchema>;
type RecipeContext = { date: string; mealType: MealType; mealName?: string; now: Date };
function missingCoreNutrients(source: RecipeInput["nutrition"]) {
  return coreNutrients.filter(key => source.basis === "ingredients" || source.nutrients[key] == null);
}

/** Reserve estimator quota only for previews that actually ask the provider for nutrition. */
export function recipeUsesEstimator(recipe: RecipeInput): boolean {
  const source = recipe.nutrition;
  return source.basis === "ingredients" || (source.estimateMissingFromIngredients === true && missingCoreNutrients(source).length > 0);
}

function signingKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new McpMutationError("Recipe preparation is unavailable. Ask the NutriTracker owner to check the connection.");
  return createHmac("sha256", secret).update("nutritracker:mcp:prepared-recipe:v1").digest();
}

function nutritionForIngredients(estimate: EstimateResponse): RecipeNutrients {
  const total: RecipeNutrients = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 };
  for (const { nutrients } of estimate.items) {
    for (const key of coreNutrients) total[key] += nutrients[key];
    total.fiber_g = total.fiber_g == null || nutrients.fiber_g == null ? null : total.fiber_g + nutrients.fiber_g;
  }
  return total;
}

export async function prepareRecipe(actorId: string, recipe: RecipeInput, context: RecipeContext, estimateIngredients: () => Promise<EstimateResponse>) {
  const source = recipe.nutrition;
  const supplied = source.basis === "ingredients" ? {} : source.nutrients;
  const missing = missingCoreNutrients(source);
  let multiplier = 1;
  if (source.basis === "per_serving") {
    if (recipe.yield.unit === "grams" && !source.servingGrams) {
      throw new McpMutationError("How many cooked grams are in one serving of the supplied nutrition? Alternatively, provide the cooked yield in equal servings.");
    }
    multiplier = recipe.yield.unit === "servings" ? recipe.yield.amount : recipe.yield.amount / source.servingGrams!;
  }
  if (missing.length && source.basis !== "ingredients" && !source.estimateMissingFromIngredients) {
    throw new McpMutationError(`The diary also needs ${missing.join(", ")}. Ask for those values, or ask whether to estimate the missing values from the stated ingredients. Nothing was saved.`);
  }
  const estimate = recipeUsesEstimator(recipe) ? await estimateIngredients() : undefined;
  const estimated = estimate && nutritionForIngredients(estimate);
  const estimatedNutrients: Array<typeof nutrientNames[number]> = [];
  function valueFor(key: typeof nutrientNames[number]) {
    const known = supplied[key];
    if (known != null) return known * multiplier;
    const value = estimated?.[key] ?? null;
    if (value != null) estimatedNutrients.push(key);
    return value;
  }
  const values = Object.fromEntries(nutrientNames.map(key => [key, valueFor(key)]));
  const nutrients = nutrientsSchema.safeParse(values);
  if (!nutrients.success) throw new McpMutationError("The recipe totals exceed the supported range. Check the supplied quantities and units.");
  const mealName = context.mealName ?? "Prepared recipe";
  const isEstimated = estimatedNutrients.length > 0;
  const data = recipeSchema.parse({
    date: context.date, mealType: context.mealType, mealName, yield: recipe.yield, isEstimated, estimatedNutrients,
    items: [{ id: "item-1", name: mealName, amount: recipe.yield.amount,
      unit: recipe.yield.unit === "grams" ? "GRAM" : "SERVING", nutrients: nutrients.data, isEstimated }],
  });
  const id = randomUUID();
  const issuedAt = Math.floor(context.now.getTime() / 1000);
  const preparedRecipeToken = await new SignJWT({ recipe: data }).setProtectedHeader({ alg: "HS256", typ: tokenType })
    .setIssuer(tokenIssuer).setAudience(tokenAudience).setSubject(actorId).setJti(id)
    .setIssuedAt(issuedAt).setExpirationTime(issuedAt + lifetimeSeconds).sign(signingKey());
  preparedRecipeTokenSchema.parse(preparedRecipeToken);
  return {
    ...data, id, totals: nutrients.data, ...(estimate ? { ingredientEstimate: estimate } : {}), preparedRecipeToken,
    expiresAt: new Date((issuedAt + lifetimeSeconds) * 1000).toISOString(), saved: false,
    nextStep: "These totals are for the entire cooked dish. Review estimated values and assumptions. Ask who ate it and their portions in the yield unit. Use this recipe token for the buddy meal preview or send-for-review tool. If the person requests only their own portion, use log_meal with selfRecipe and that exact portion. Keep the token private.",
  };
}

export async function verifyPreparedRecipe(actorId: string, token: string): Promise<VerifiedRecipe> {
  try {
    const { payload } = await jwtVerify(preparedRecipeTokenSchema.parse(token), signingKey(), {
      algorithms: ["HS256"], issuer: tokenIssuer, audience: tokenAudience, subject: actorId, typ: tokenType,
    });
    const signed = signedSchema.parse(payload);
    if (signed.exp - signed.iat !== lifetimeSeconds || signed.iat > Math.floor(Date.now() / 1000) + 30) throw new Error();
    return { ...signed.recipe, id: signed.jti, actorId: signed.sub };
  } catch {
    throw new McpMutationError("This prepared recipe has expired, is invalid, or belongs to another account. Check whether the meal was already logged before preparing it again.");
  }
}

export function recipeSnapshotItems(verified: VerifiedRecipe): StoredMealItem[] {
  return verified.items.map(item => {
    const portionLabel = `${item.amount} ${item.unit === "GRAM" ? "g" : item.amount === 1 ? "serving" : "servings"}`;
    return {
      id: item.id, name: item.name, amount: item.amount, unit: item.unit, portionLabel,
      foodId: `preview:${verified.id}:${item.id}`, mealType: verified.mealType, mealName: verified.mealName,
      isEstimated: item.isEstimated, sourceText: null,
      estimationMeta: { repeatPortionLabel: portionLabel, estimatedNutrients: verified.estimatedNutrients },
      snapshotKcal: item.nutrients.kcal, snapshotProteinG: item.nutrients.protein_g,
      snapshotCarbsG: item.nutrients.carbs_g, snapshotFatG: item.nutrients.fat_g, snapshotFiberG: item.nutrients.fiber_g,
    };
  });
}

/** Only the saving transaction creates Food records. The full recipe itself is never a diary entry. */
export async function materializeRecipeItems(tx: Prisma.TransactionClient, actorId: string, verified: VerifiedRecipe): Promise<StoredMealItem[]> {
  if (actorId !== verified.actorId) throw new McpMutationError("Prepare this recipe with the connected account.");
  const snapshots = recipeSnapshotItems(verified);
  for (const item of snapshots) {
    const grams = item.unit === "GRAM";
    // For serving-only foods these required database columns store nutrients per serving.
    // The explicit basis prevents gram-based reuse until a weight is known.
    const factor = (grams ? 100 : 1) / item.amount;
    const data = [item.snapshotKcal, item.snapshotProteinG, item.snapshotCarbsG, item.snapshotFatG, item.snapshotFiberG ?? 0];
    if (!data.every(value => Number.isFinite(value * factor))) throw new McpMutationError("Check the cooked yield. This recipe amount is too small to normalize.");
    const food = await tx.food.create({ data: {
      name: item.name, source: item.isEstimated ? "LLM" : "MANUAL", createdByUserId: actorId,
      nutritionBasis: grams ? "GRAMS" : "SERVINGS", kcalPer100g: item.snapshotKcal * factor,
      proteinPer100g: item.snapshotProteinG * factor, carbsPer100g: item.snapshotCarbsG * factor,
      fatPer100g: item.snapshotFatG * factor, fiberPer100g: item.snapshotFiberG == null ? null : item.snapshotFiberG * factor,
    }, select: { id: true } });
    item.foodId = food.id;
  }
  return snapshots;
}
