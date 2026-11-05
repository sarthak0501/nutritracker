import { createHash, createHmac, randomUUID } from "node:crypto";
import { MealType, type Food, type LogEntry, type PrismaClient } from "@prisma/client";
import { SignJWT, compactVerify } from "jose";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { estimateNutritionFromText, parseNutritionEstimate, type EstimateResponse } from "@/lib/llm";
import { insertEstimatedItems } from "@/lib/estimated-meals";
import { mealDateSchema, undoMealBatch, withMealBatch } from "@/lib/meal-writes";
import { safeNutrientsForEntry, type Nutrients } from "@/lib/nutrition";

/** Only messages from this class are safe to return through MCP. */
export class McpNutritionError extends Error {
  constructor(message: string) { super(message); this.name = "McpNutritionError"; }
}

// Match the website's calendar unless the person explicitly asks for another zone.
export const MCP_DEFAULT_TIMEZONE = "America/Los_Angeles";
const MAX_PREPARED_TOKEN_LENGTH = 65_536;
const PREPARED_MEAL_SECONDS = 30 * 60;
const MAX_QUERY_ENTRIES = 10_000;
const tokenIssuer = "nutritracker:prepared-meal";
const timezoneSchema = z.string().max(80).refine((value) => {
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }); return true; } catch { return false; }
}, "Use a valid IANA timezone, such as America/Los_Angeles");
const timezoneInput = timezoneSchema.optional().describe("Only supply when the user explicitly requests a timezone; otherwise the website's America/Los_Angeles calendar is used.");

export const DayProgressSchema = z.object({
  date: mealDateSchema.optional().describe("Calendar date YYYY-MM-DD; omitted means today in the supplied timezone."),
  timezone: timezoneInput,
}).strict();
export const ProgressSchema = z.object({
  endDate: mealDateSchema.optional().describe("Last calendar date of the range, inclusive; omitted means today."),
  days: z.number().int().min(1).max(31).default(7),
  timezone: timezoneInput,
}).strict();
export const PrepareMcpMealSchema = z.object({
  description: z.string().trim().min(1).max(2000).describe("The person's meal description, including portions and any corrections."),
  date: mealDateSchema.optional(),
  mealType: z.nativeEnum(MealType),
  mealName: z.string().trim().min(1).max(200).optional(),
  timezone: timezoneInput,
}).strict();
export const CommitMcpMealSchema = z.object({
  preparedMealToken: z.string().min(1).max(MAX_PREPARED_TOKEN_LENGTH).describe("Exact opaque token returned by prepare_meal. Reuse the same token when retrying the same save."),
}).strict();
export const UndoMcpMealSchema = z.object({ batchId: z.string().min(1).max(128) }).strict();

type EntryWithFood = LogEntry & { food: Food };
type Totals = { kcal: number; protein_g: number; carbs_g: number; fat_g: number; fiber_g: number | null };
type Targets = { kcal: number; protein_g: number; carbs_g: number; fat_g: number; fiber_g: number | null };
type ProfileTargets = { kcalTarget: number; proteinTarget: number; carbsTarget: number; fatTarget: number; fiberTarget: number | null };

export function mcpCalendarDate(timezone = MCP_DEFAULT_TIMEZONE, now = new Date()): string {
  timezoneSchema.parse(timezone);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = (kind: string) => parts.find((part) => part.type === kind)!.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function targetsFor(profile: ProfileTargets | null): Targets {
  return {
    kcal: profile?.kcalTarget ?? 2000, protein_g: profile?.proteinTarget ?? 120,
    carbs_g: profile?.carbsTarget ?? 250, fat_g: profile?.fatTarget ?? 70,
    fiber_g: profile ? profile.fiberTarget : 30,
  };
}

function totalsFor(nutrients: Array<Nutrients | null>): Totals {
  const totals: Totals = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: null };
  for (const n of nutrients) {
    if (!n) continue;
    totals.kcal += n.kcal; totals.protein_g += n.protein_g; totals.carbs_g += n.carbs_g; totals.fat_g += n.fat_g;
    if (n.fiber_g != null) totals.fiber_g = (totals.fiber_g ?? 0) + n.fiber_g;
  }
  return totals;
}

function remainingFor(totals: Totals, targets: Targets): Targets {
  return {
    kcal: Math.max(0, targets.kcal - totals.kcal),
    protein_g: Math.max(0, targets.protein_g - totals.protein_g),
    carbs_g: Math.max(0, targets.carbs_g - totals.carbs_g),
    fat_g: Math.max(0, targets.fat_g - totals.fat_g),
    fiber_g: targets.fiber_g == null || totals.fiber_g == null ? null : Math.max(0, targets.fiber_g - totals.fiber_g),
  };
}

function summarizeEntries(entries: EntryWithFood[]) {
  const nutrients = entries.map((entry) => safeNutrientsForEntry(entry, entry.food));
  const entriesMissingNutrition = nutrients.filter((n) => n === null).length;
  const entriesMissingFiber = nutrients.filter((n) => n?.fiber_g == null).length;
  return {
    totals: totalsFor(nutrients),
    entryCount: entries.length,
    entriesWithNutrition: nutrients.filter((n) => n !== null).length,
    entriesMissingNutrition, entriesMissingFiber,
    nutritionCompleteForRecordedEntries: entriesMissingNutrition === 0,
    fiberCompleteForRecordedEntries: entriesMissingFiber === 0,
  };
}

function checkQueryBound(entries: unknown[]) {
  if (entries.length > MAX_QUERY_ENTRIES) throw new McpNutritionError("This range has too many food entries. Request a shorter date range or view it on the website.");
}

async function accountData(userId: string, client: PrismaClient) {
  const user = await client.user.findUnique({
    where: { id: userId },
    select: { username: true, profile: { select: { kcalTarget: true, proteinTarget: true, carbsTarget: true, fatTarget: true, fiberTarget: true } } },
  });
  if (!user) throw new McpNutritionError("Account is no longer available. Reconnect NutriTracker.");
  return { username: user.username, targets: targetsFor(user.profile), targetSource: user.profile ? "profile" : "app_defaults" };
}

export async function getMcpAccount(userId: string, client: PrismaClient = prisma) {
  return { ...await accountData(userId, client), timezone: MCP_DEFAULT_TIMEZONE, today: mcpCalendarDate(), timezoneSource: "website_default" };
}

export async function getMcpDayProgress(userId: string, input: z.input<typeof DayProgressSchema> = {}, client: PrismaClient = prisma) {
  const parsed = DayProgressSchema.parse(input);
  const timezone = parsed.timezone ?? MCP_DEFAULT_TIMEZONE;
  const date = parsed.date ?? mcpCalendarDate(timezone);
  const [account, entries, water, workouts] = await Promise.all([
    accountData(userId, client),
    client.logEntry.findMany({ where: { userId, date }, include: { food: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: MAX_QUERY_ENTRIES + 1 }),
    client.waterEntry.findUnique({ where: { userId_date: { userId, date } }, select: { glasses: true } }),
    client.workoutEntry.aggregate({ where: { userId, date }, _sum: { caloriesBurned: true }, _count: { _all: true, caloriesBurned: true } }),
  ]);
  checkQueryBound(entries);
  const summary = summarizeEntries(entries);
  const remaining = summary.nutritionCompleteForRecordedEntries ? remainingFor(summary.totals, account.targets) : null;
  if (remaining && !summary.fiberCompleteForRecordedEntries) remaining.fiber_g = null;
  return {
    ...account, date, timezone, ...summary, remaining,
    waterGlasses: water?.glasses ?? 0,
    workouts: { count: workouts._count._all, estimatedCaloriesBurned: workouts._sum.caloriesBurned, entriesMissingCalories: workouts._count._all - workouts._count.caloriesBurned },
    entries: entries.slice(0, 100).map((entry) => ({
      id: entry.id, updatedAt: entry.updatedAt.toISOString(), date: entry.date, batchId: entry.batchId, mealType: entry.mealType, mealName: entry.mealName,
      food: entry.food.name, amount: entry.amount, unit: entry.unit, isEstimated: entry.isEstimated,
      nutrients: safeNutrientsForEntry(entry, entry.food),
    })),
    entriesTruncated: entries.length > 100,
    coverageNote: "Totals reflect known nutrition in recorded food only. Unlogged meals are unknown, not zero intake. Missing nutrition is excluded and makes remaining targets unavailable; fiber totals may be partial and remaining fiber is unavailable when any entry lacks fiber. Complete-for-recorded-entries flags do not establish a fully logged day. Workout calories are shown separately and do not increase food targets.",
  };
}

export async function getMcpProgress(userId: string, input: z.input<typeof ProgressSchema> = {}, client: PrismaClient = prisma) {
  const parsed = ProgressSchema.parse(input);
  const timezone = parsed.timezone ?? MCP_DEFAULT_TIMEZONE;
  const endDate = parsed.endDate ?? mcpCalendarDate(timezone);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  const dates = Array.from({ length: parsed.days }, (_, index) => new Date(end.getTime() - (parsed.days - index - 1) * 86_400_000).toISOString().slice(0, 10));
  const [account, entries] = await Promise.all([
    accountData(userId, client),
    client.logEntry.findMany({ where: { userId, date: { gte: dates[0], lte: endDate } }, include: { food: true }, orderBy: { date: "asc" }, take: MAX_QUERY_ENTRIES + 1 }),
  ]);
  checkQueryBound(entries);
  const daily = dates.map((date) => ({ date, ...summarizeEntries(entries.filter((entry) => entry.date === date)) }));
  const summary = summarizeEntries(entries);
  const loggedDays = daily.filter((day) => day.entryCount > 0).length;
  const averagesPerLoggedDay = loggedDays ? Object.fromEntries(Object.entries(summary.totals).map(([key, value]) => [key, value == null ? null : value / loggedDays])) : null;
  return {
    ...account, startDate: dates[0], endDate, timezone, days: parsed.days, loggedDays,
    unloggedDays: parsed.days - loggedDays, ...summary, averagesPerLoggedDay, daily,
    coverageNote: "Averages divide recorded nutrition by days with at least one food entry. They do not establish complete daily intake. Unlogged days are unknown; missing nutrition and fiber are reported separately. Targets are your current settings, not historical targets.",
  };
}

function preparedMealKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new McpNutritionError("Meal preparation is unavailable. Ask the NutriTracker owner to finish configuring the connection.");
  return createHmac("sha256", secret).update("nutritracker:mcp:prepared-meal:v1").digest();
}

function boundedEstimate(value: unknown): EstimateResponse {
  const estimate = parseNutritionEstimate(value);
  if (estimate.items.length > 30 || estimate.notes.length > 30 || estimate.notes.some((note) => note.length > 500) || estimate.items.some((item) =>
    item.description.length > 500 || item.assumptions.length > 30 || item.assumptions.some((note) => note.length > 500))) {
    throw new McpNutritionError("This estimate is too large. Describe a smaller meal and try again.");
  }
  return estimate;
}

const preparedPayloadSchema = PrepareMcpMealSchema.extend({ date: mealDateSchema, timezone: timezoneSchema, estimate: z.unknown() }).strict();
const signedMealSchema = z.object({
  iss: z.literal(tokenIssuer), aud: z.literal("nutritracker:mcp:commit-meal"),
  sub: z.string().min(1), jti: z.string().uuid(), iat: z.number().int().positive(),
  exp: z.number().int().positive(), meal: preparedPayloadSchema,
}).strict();
type PrepareOptions = { client?: PrismaClient; estimate?: typeof estimateNutritionFromText; now?: Date };

export async function prepareMcpMeal(userId: string, input: z.input<typeof PrepareMcpMealSchema>, options: PrepareOptions = {}) {
  const parsed = PrepareMcpMealSchema.parse(input);
  const key = preparedMealKey();
  const account = await accountData(userId, options.client ?? prisma);
  const now = options.now ?? new Date();
  const timezone = parsed.timezone ?? MCP_DEFAULT_TIMEZONE;
  const date = parsed.date ?? mcpCalendarDate(timezone, now);
  let estimate: EstimateResponse;
  try {
    estimate = boundedEstimate(await (options.estimate ?? estimateNutritionFromText)({ text: parsed.description }));
  } catch (error) {
    if (error instanceof McpNutritionError) throw error;
    throw new McpNutritionError("NutriTracker could not estimate this meal. Nothing was saved. Please try again with a clear description and portions.");
  }
  const payload = { ...parsed, date, timezone, estimate };
  const preparedMealToken = await new SignJWT({ meal: payload })
    .setProtectedHeader({ alg: "HS256", typ: "nt-prepared-meal+jwt" })
    .setIssuer(tokenIssuer).setAudience("nutritracker:mcp:commit-meal").setSubject(userId)
    .setJti(randomUUID()).setIssuedAt(Math.floor(now.getTime() / 1000))
    .setExpirationTime(Math.floor(now.getTime() / 1000) + PREPARED_MEAL_SECONDS).sign(key);
  if (preparedMealToken.length > MAX_PREPARED_TOKEN_LENGTH) throw new McpNutritionError("This estimate is too large. Describe a smaller meal and try again.");
  return {
    username: account.username, date, timezone, mealType: parsed.mealType, mealName: parsed.mealName ?? null,
    estimate, estimatedTotals: totalsFor(estimate.items.map((item) => item.nutrients)),
    preparedMealToken, expiresAt: new Date(now.getTime() + PREPARED_MEAL_SECONDS * 1000).toISOString(),
    saved: false,
    nextStep: "Review the portions, date, and assumptions with the user. Commit this exact token only when the user has requested saving this meal. Reuse this token for a retry; prepare a new token only for a different or corrected meal. Never show or modify the token.",
  };
}

export async function commitMcpMeal(userId: string, input: z.input<typeof CommitMcpMealSchema>, client: PrismaClient = prisma) {
  const { preparedMealToken } = CommitMcpMealSchema.parse(input);
  const nowSeconds = Math.floor(Date.now() / 1000);
  let signed: z.infer<typeof signedMealSchema>;
  try {
    const verified = await compactVerify(preparedMealToken, preparedMealKey(), { algorithms: ["HS256"] });
    signed = signedMealSchema.parse(JSON.parse(new TextDecoder().decode(verified.payload)));
    if (verified.protectedHeader.typ !== "nt-prepared-meal+jwt" || signed.sub !== userId ||
      signed.exp - signed.iat !== PREPARED_MEAL_SECONDS || signed.iat > nowSeconds + 30) throw new Error("Invalid token claims");
  } catch {
    throw new McpNutritionError("This meal preview is invalid or belongs to another account. Prepare the meal again for the connected account.");
  }
  const requestId = signed.jti;
  const meal = signed.meal;
  const estimate = boundedEstimate(meal.estimate);
  // Bind the idempotency key to these exact immutable contents, even if a future
  // caller accidentally reuses a request ID for a different signed preview.
  const payloadHash = createHash("sha256").update(JSON.stringify(meal)).digest("hex");
  const kind = `mcp-meal:${meal.date}:${payloadHash}`;
  // Expiration forbids a new write. A signed expired token can still retrieve
  // its prior receipt, so a delayed retry cannot prompt an accidental new meal.
  const existing = signed.exp <= nowSeconds ? await client.logBatch.findUnique({
    where: { userId_requestId: { userId, requestId: `mcp:${requestId}` } }, include: { _count: { select: { entries: true } } },
  }) : null;
  if (signed.exp <= nowSeconds && (!existing || existing.kind !== kind)) {
    throw new McpNutritionError("This unsaved meal preview has expired. Check your meal history before preparing and saving it again.");
  }
  const receipt = existing
    ? { batchId: existing.id, entryCount: existing._count.entries, alreadySaved: true, ...(existing.undoneAt ? { undone: true } : {}) }
    : await withMealBatch({ userId, requestId: `mcp:${requestId}`, kind }, (tx, batchId) =>
      insertEstimatedItems(tx, { userId, batchId, date: meal.date, mealType: meal.mealType,
        mealName: meal.mealName, sourceText: meal.description, items: estimate.items }), client);
  const batch = await client.logBatch.findFirstOrThrow({ where: { id: receipt.batchId, userId }, select: { createdAt: true } });
  return {
    ...receipt, saved: !receipt.undone, date: meal.date,
    undoExpiresAt: new Date(batch.createdAt.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    dayProgress: await getMcpDayProgress(userId, { date: meal.date, timezone: meal.timezone }, client),
  };
}

export async function undoMcpMeal(userId: string, input: z.input<typeof UndoMcpMealSchema>, client: PrismaClient = prisma) {
  const { batchId } = UndoMcpMealSchema.parse(input);
  const batch = await client.logBatch.findFirst({ where: { id: batchId, userId }, select: { kind: true } });
  if (!batch || !batch.kind.startsWith("mcp-meal:")) throw new McpNutritionError("This Claude meal save was not found in your account. Use the website to remove other entries.");
  const date = mealDateSchema.parse(batch.kind.split(":")[1]);
  let receipt;
  try {
    receipt = await undoMealBatch(userId, batchId, client);
  } catch (error) {
    if (error instanceof Error && error.message === "Undo is available for 24 hours. You can still remove individual entries.") {
      throw new McpNutritionError("Undo is available for 24 hours after saving. You can still remove the meal entries on the NutriTracker website.");
    }
    throw error;
  }
  return { ...receipt, date, dayProgress: await getMcpDayProgress(userId, { date }, client) };
}
