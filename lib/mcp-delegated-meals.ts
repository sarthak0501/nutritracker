import { createHmac, timingSafeEqual } from "node:crypto";
import { MealType, Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { buddyMealLoggingEnabled } from "@/lib/buddy-meal-feature";
import { prisma } from "@/lib/db";
import {
  itemForSharing, parseStoredItems, scaleStoredMealItem, storedItemFromEntry, type StoredMealItem,
} from "@/lib/meal-library";
import { entriesOccurrence, savedOccurrence, findMealOccurrence, selfPlateBatchRequestId, plateBatchRequestId, checkRecipeAllocation } from "@/lib/meal-occurrence";
import { insertMealSnapshots, mealDateSchema } from "@/lib/meal-writes";
import { McpMutationError, requestIdSchema, withMcpMutation } from "@/lib/mcp-mutations";
import { materializeRecipeItems, preparedRecipeTokenSchema, recipeSnapshotItems, verifyPreparedRecipe } from "@/lib/mcp-recipe";

const id = z.string().trim().min(1).max(200);
const version = z.string().datetime();
export const recipeSourceSchema = z.object({
  kind: z.literal("recipe"), preparedRecipeToken: preparedRecipeTokenSchema,
}).strict();
const delegatedSourceSchema = z.discriminatedUnion("kind", [
  recipeSourceSchema,
  z.object({ kind: z.literal("saved"), id, expectedUpdatedAt: version,
    occurrenceId: requestIdSchema.describe("One ID for this instance of eating the preset. Keep it when switching between sharing and direct logging.") }).strict(),
  z.object({ kind: z.literal("entries"), entries: z.array(z.object({ id, expectedUpdatedAt: version }).strict()).min(1).max(100) }).strict(),
]);
export const plateSchema = z.array(z.object({
  amount: z.number().finite().positive().max(1000000),
  unit: z.enum(["grams", "servings", "reference"]).describe("Use the recipe's cooked yield unit, or 'reference' for multiples of a saved meal or already logged plate."),
  selectedItemIds: z.array(id).min(1).max(100).optional().describe("Omit to apply this amount to every item. An item may appear only once per person."),
}).strict()).min(1).max(100);
export const PreviewBuddyMealSchema = z.object({
  source: delegatedSourceSchema, recipientId: id,
  date: mealDateSchema, mealType: z.nativeEnum(MealType),
  buddyPortion: plateSchema, selfPortion: plateSchema.optional().describe("Include only if the cook explicitly wants their own plate logged. Omit when using existing log entries."),
}).strict();
export const LogBuddyMealSchema = PreviewBuddyMealSchema.extend({
  requestId: requestIdSchema, reviewToken: z.string().min(1).max(160),
  confirmed: z.literal(true).describe("True when the person explicitly requests logging these portions for these people."),
}).strict();

type Intent = z.output<typeof PreviewBuddyMealSchema>;
type Plate = z.output<typeof plateSchema>;
type Yield = { unit: "grams" | "servings"; amount: number };
type Tx = Prisma.TransactionClient;

export async function checkMealBuddy(tx: Tx, actorId: string, recipientId: string, direct: boolean) {
  if (direct && !buddyMealLoggingEnabled()) throw new McpMutationError("Direct buddy meal logging is currently unavailable. You can send a meal for review.");
  const rows = await tx.$queryRaw<{ requesterId: string; requesterAllowsMealLogging: boolean; addresseeAllowsMealLogging: boolean }[]>`
    SELECT "requesterId", "requesterAllowsMealLogging", "addresseeAllowsMealLogging" FROM "BuddyRelationship"
    WHERE status = 'ACCEPTED' AND (("requesterId" = ${actorId} AND "addresseeId" = ${recipientId})
      OR ("requesterId" = ${recipientId} AND "addresseeId" = ${actorId})) ORDER BY id FOR SHARE`;
  if (!rows.length || actorId === recipientId) throw new McpMutationError("This person is not a connected buddy. Check your buddy list.");
  const granted = rows.every(row => row.requesterId === recipientId ? row.requesterAllowsMealLogging : row.addresseeAllowsMealLogging);
  if (direct && !granted) throw new McpMutationError("Your buddy has not enabled direct meal logging for you. Ask whether to send the meal for review. Neither diary was changed.");
  return granted;
}

async function reviewedRecipe(actorId: string, token: string, date: string, mealType: MealType) {
  const recipe = await verifyPreparedRecipe(actorId, token);
  if (recipe.date !== date || recipe.mealType !== mealType)
    throw new McpMutationError("The recipe preview was prepared for a different date or meal. Prepare it again with the intended date and meal.");
  return { items: recipeSnapshotItems(recipe), recipe, yield: recipe.yield, occurrence: "recipe:" + recipe.id };
}

export async function resolveReviewedSource(tx: Tx, actorId: string, intent: Pick<Intent, "source" | "date" | "mealType" | "selfPortion">) {
  const { source, date, mealType } = intent;
  if (source.kind === "recipe") return reviewedRecipe(actorId, source.preparedRecipeToken, date, mealType);
  if (source.kind === "saved") {
    const [row] = await tx.$queryRaw<{ items: Prisma.JsonValue; updatedAt: Date }[]>`
      SELECT items, "updatedAt" FROM "SavedMeal" WHERE id = ${source.id} AND "userId" = ${actorId} FOR SHARE`;
    if (!row || row.updatedAt.toISOString() !== source.expectedUpdatedAt)
      throw new McpMutationError("The saved meal is missing or changed. Read it again and review the new portions.");
    return { items: parseStoredItems(row.items), recipe: null, occurrence: savedOccurrence(source.occurrenceId), yield: null };
  }
  if (intent.selfPortion) throw new McpMutationError("Those entries are already in your log. Omit your portion to add only the buddy's meal.");
  const ids = source.entries.map(entry => entry.id);
  const versions = new Map(source.entries.map(entry => [entry.id, entry.expectedUpdatedAt]));
  if (versions.size !== ids.length) throw new McpMutationError("Select each source entry only once.");
  // A legacy entry without snapshots can depend on the current food record as well.
  const locked = await tx.$queryRaw<{ id: string; updatedAt: Date }[]>`
    SELECT e.id, e."updatedAt" FROM "LogEntry" e JOIN "Food" f ON f.id = e."foodId"
    WHERE e."userId" = ${actorId} AND e.id IN (${Prisma.join(ids)}) ORDER BY e.id FOR SHARE OF e, f`;
  if (locked.length !== ids.length || locked.some(row => row.updatedAt.toISOString() !== versions.get(row.id)))
    throw new McpMutationError("A selected entry is missing or changed. Read your daily log again and review the new portions.");
  const rows = await tx.logEntry.findMany({ where: { userId: actorId, id: { in: ids } }, orderBy: { id: "asc" }, include: { food: true } });
  return { items: rows.map(storedItemFromEntry), recipe: null, occurrence: entriesOccurrence(ids, date, mealType), yield: null };
}

function allocatedFactors(items: StoredMealItem[], plate: Plate, basis: Yield | null) {
  const factors = new Map<string, number>();
  const ids = new Set(items.map(item => item.id));
  for (const portion of plate) {
    if (portion.unit !== (basis?.unit ?? "reference"))
      throw new McpMutationError("Use the same unit as the reference. Ask for a measured conversion or prepare the recipe with the correct cooked yield.");
    const factor = portion.amount / (basis?.amount ?? 1);
    if (!Number.isFinite(factor) || factor <= 0 || (!basis && factor > 20))
      throw new McpMutationError("Please check the portion. Saved meals and logged plates support up to 20 times the reference.");
    for (const id of portion.selectedItemIds ?? ids) {
      if (!ids.has(id) || factors.has(id)) throw new McpMutationError("A selected item is missing or selected twice for one person. Review the items and portions.");
      factors.set(id, factor);
    }
  }
  return factors;
}

export function allocatePlates(items: StoredMealItem[], basis: Yield | null, buddyPortion: Plate, selfPortion?: Plate) {
  const buddy = allocatedFactors(items, buddyPortion, basis);
  const self = selfPortion ? allocatedFactors(items, selfPortion, basis) : new Map<string, number>();
  if (basis && items.some(item => (buddy.get(item.id) ?? 0) + (self.get(item.id) ?? 0) > 1 + 1e-12))
    throw new McpMutationError("The portions add up to more than the cooked yield. Check the yield and how much each person ate.");
  const scaled = (factors: Map<string, number>) => items.filter(item => factors.has(item.id)).map(item => scaleStoredMealItem(item, factors.get(item.id)!));
  return { buddy: scaled(buddy).map(itemForSharing), self: scaled(self) };
}

function summarize(items: StoredMealItem[]) {
  const totals = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 as number | null };
  const summary = items.map(item => {
    totals.kcal += item.snapshotKcal;
    totals.protein_g += item.snapshotProteinG;
    totals.carbs_g += item.snapshotCarbsG;
    totals.fat_g += item.snapshotFatG;
    totals.fiber_g = totals.fiber_g == null || item.snapshotFiberG == null ? null : totals.fiber_g + item.snapshotFiberG;
    return { id: item.id, name: item.name, amount: item.amount, unit: item.unit, portion: item.portionLabel,
      kcal: item.snapshotKcal, protein_g: item.snapshotProteinG, carbs_g: item.snapshotCarbsG, fat_g: item.snapshotFatG,
      fiber_g: item.snapshotFiberG, estimated: item.isEstimated };
  });
  return { items: summary, totals };
}
type Portions = ReturnType<typeof allocatePlates>;

function signature(actorId: string, intent: Intent, portions: Portions, expires: number) {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new McpMutationError("NutriTracker meal review is unavailable. Check the connection configuration.");
  const data = [actorId, intent, summarize(portions.buddy), summarize(portions.self), expires];
  return createHmac("sha256", secret).update("nutritracker:buddy-plate-review:v1\0").update(JSON.stringify(data)).digest("hex");
}

export async function previewMcpBuddyMeal(actorId: string, input: z.input<typeof PreviewBuddyMealSchema>, client: PrismaClient = prisma) {
  const intent = PreviewBuddyMealSchema.parse(input);
  return client.$transaction(async tx => {
    const grant = await checkMealBuddy(tx, actorId, intent.recipientId, false);
    const source = await resolveReviewedSource(tx, actorId, intent);
    const plates = allocatePlates(source.items, source.yield, intent.buddyPortion, intent.selfPortion);
    const expires = Math.floor(Date.now() / 1000) + 1800;
    const recipient = await tx.user.findUniqueOrThrow({ where: { id: intent.recipientId }, select: { username: true } });
    return { reviewToken: `${expires}.${signature(actorId, intent, plates, expires)}`,
      mayLogForBuddy: grant && buddyMealLoggingEnabled(), date: intent.date, mealType: intent.mealType,
      buddy: { username: recipient.username, ...summarize(plates.buddy) }, self: intent.selfPortion ? summarize(plates.self) : null };
  });
}

async function writePlate(tx: Tx, userId: string, requestId: string, intent: Intent, items: StoredMealItem[], loggedByUsername?: string) {
  const batch = await tx.logBatch.create({ data: { userId, requestId, kind: `mcp-buddy:${intent.date}`, loggedByUsername } });
  await insertMealSnapshots(tx, { userId, batchId: batch.id, date: intent.date, mealType: intent.mealType, items });
  return batch.id;
}

export async function logMcpBuddyMeal(actorId: string, input: z.input<typeof LogBuddyMealSchema>, client: PrismaClient = prisma) {
  const parsed = LogBuddyMealSchema.parse(input);
  const { requestId, reviewToken } = parsed;
  const intent = PreviewBuddyMealSchema.strip().parse(parsed);
  const receipt = await withMcpMutation(actorId, requestId, "log_buddy_meal", parsed, async tx => {
    const source = await resolveReviewedSource(tx, actorId, intent);
    const plates = allocatePlates(source.items, source.yield, intent.buddyPortion, intent.selfPortion);
    const [until, mac] = reviewToken.split(".");
    const expires = Number(until);
    if (!/^\d{10}\.[0-9a-f]{64}$/.test(reviewToken) || expires <= Math.floor(Date.now() / 1000)
      || !timingSafeEqual(Buffer.from(mac, "hex"), Buffer.from(signature(actorId, intent, plates, expires), "hex")))
      throw new McpMutationError("The reviewed people, meal or portions changed, or the review expired. Preview the portions again before saving.");
    const prior = await findMealOccurrence(tx, actorId, intent.recipientId, source.occurrence, intent.date, intent.mealType, plates.buddy.map(item => item.id));
    if (prior?.status === "PENDING") throw new McpMutationError("A proposal for this meal is already waiting for your buddy. Have them answer it first. Neither diary was changed.");
    if (prior?.status === "DECLINED") throw new McpMutationError("Your buddy declined this occurrence. No additional meal was logged.");
    if (prior) return { status: "previously_logged", note: "This meal was previously posted. Nothing was added. Each owner can read their daily log for its current state." };
    const selfKey = selfPlateBatchRequestId(actorId, source.occurrence);
    if (intent.selfPortion && await tx.logBatch.findUnique({ where: { userId_requestId: { userId: actorId, requestId: selfKey } }, select: { id: true } }))
      throw new McpMutationError("Your portion was already logged. Omit selfPortion and review just your buddy's plate.");
    // A prepared recipe represents one whole dish, with one stable item in the cooked yield unit.
    const amount = [...plates.buddy, ...plates.self].reduce((total, item) => total + item.amount, 0);
    const recipeAllocation = source.recipe ? await checkRecipeAllocation(tx, actorId, source.recipe.id, amount, source.recipe.yield.amount) : undefined;
    const [actor, recipient] = await Promise.all([actorId, intent.recipientId].map(id => tx.user.findUniqueOrThrow({ where: { id }, select: { username: true } })));
    const sourceItems = source.recipe ? await materializeRecipeItems(tx, actorId, source.recipe) : source.items;
    const actual = allocatePlates(sourceItems, source.yield, intent.buddyPortion, intent.selfPortion);
    const selfBatch = actual.self.length ? await writePlate(tx, actorId, selfKey, intent, actual.self) : undefined;
    const buddyBatch = await writePlate(tx, intent.recipientId, plateBatchRequestId(actorId, source.occurrence, "buddy"), intent, actual.buddy, actor.username);
    await tx.mealProposal.create({ data: { senderId: actorId, recipientId: intent.recipientId, occurrenceKey: source.occurrence,
      senderRequestId: "direct:" + requestId, status: "DIRECT", respondedAt: new Date(), name: "Buddy meal",
      date: intent.date, mealType: intent.mealType, items: intent.source.kind === "entries" ? actual.buddy.map(item => ({ id: item.id })) : [], acceptedBatchId: buddyBatch } });
    return { status: "originally_logged", recipeAllocation, date: intent.date, mealType: intent.mealType,
      buddy: { username: recipient.username, portions: intent.buddyPortion, totals: summarize(actual.buddy).totals },
      self: selfBatch ? { username: actor.username, batchId: selfBatch, portions: intent.selfPortion, totals: summarize(actual.self).totals } : null,
      note: "Receipt for the original save. Each owner can check their daily log for later changes." };
  }, client, { otherAccounts: [intent.recipientId], authorize: async tx => { await checkMealBuddy(tx, actorId, intent.recipientId, true); } });
  const { recipeAllocation, ...publicReceipt } = receipt;
  void recipeAllocation;
  return publicReceipt;
}
