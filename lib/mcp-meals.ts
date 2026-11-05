import { createHash } from "node:crypto";
import { MealType, Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { McpMutationError, withMcpMutation } from "@/lib/mcp-mutations";
import { itemForSharing, parseStoredItems, publicMealItem, resolveSource, selectMealItems } from "@/lib/meal-library";
import { insertMealSnapshots, mealDateSchema, snapshotMealEntry, withMealBatchInTransaction } from "@/lib/meal-writes";

const id = z.string().trim().min(1).max(200);
const requestId = z.string().trim().min(1).max(128).describe("Unique ID for this requested change. Reuse exactly on retries; use a new ID for a different change.");
const version = z.string().datetime().describe("Exact updatedAt returned when reading this record. Refresh before editing if stale.");
const name = z.string().trim().min(1).max(100);
const source = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("saved"), id }).strict(),
  z.object({ kind: z.literal("entries"), entryIds: z.array(id).min(1).max(100) }).strict(),
]);
const selection = {
  multiplier: z.number().finite().min(0.25).max(4).default(1).describe("Portion relative to the saved/source meal; confirm with the person."),
  selectedItemIds: z.array(id).min(1).max(100).optional(),
};
export const GetSavedMealsSchema = z.object({
  offset: z.number().int().min(0).max(10000).default(0),
  limit: z.number().int().min(1).max(50).default(20),
}).strict();
export const SaveMealPresetSchema = z.object({ requestId, name, source, ...selection }).strict();
export const RemoveMealPresetSchema = z.object({ requestId, id, expectedUpdatedAt: version }).strict();
export const LogExistingMealSchema = z.object({ requestId, source, date: mealDateSchema, mealType: z.nativeEnum(MealType), ...selection }).strict();
const entryEdit = z.discriminatedUnion("action", [
  z.object({ action: z.literal("remove"), entryId: id, expectedUpdatedAt: version }).strict(),
  z.object({
    action: z.literal("update"), entryId: id, expectedUpdatedAt: version,
    multiplier: z.number().finite().min(0.05).max(20).optional().describe("Scale the CURRENT logged portion and nutrient snapshots by this factor; e.g. 0.5 halves it."),
    date: mealDateSchema.optional(), mealType: z.nativeEnum(MealType).optional(), mealName: name.nullable().optional(),
  }).strict().refine(value => value.multiplier !== undefined || value.date !== undefined || value.mealType !== undefined || value.mealName !== undefined, "Specify a change."),
]);
export const CorrectMealEntriesSchema = z.object({ requestId, entries: z.array(entryEdit).min(1).max(100) }).strict()
  .refine(value => new Set(value.entries.map(entry => entry.entryId)).size === value.entries.length, "Each entry can be changed only once per request.");
export const GetBuddyMealsSchema = z.object({
  offset: z.number().int().min(0).max(10000).default(0),
  limit: z.number().int().min(1).max(50).default(20),
}).strict();
export const ShareMealSchema = LogExistingMealSchema.extend({
  recipientId: id, name: name.optional(),
  confirmed: z.literal(true).describe("True only after the person explicitly asks to share these selected meal details with this identified buddy."),
}).strict();
export const RespondSharedMealSchema = z.object({
  requestId, proposalId: id, action: z.enum(["accept", "decline"]),
  date: mealDateSchema.optional(), mealType: z.nativeEnum(MealType).optional(), ...selection,
}).strict().refine(value => value.action !== "accept" || (value.date !== undefined && value.mealType !== undefined), "Choose your date and meal before accepting.");

function json(value: unknown): Prisma.InputJsonValue { return JSON.parse(JSON.stringify(value)); }
function safeVersion(value: Date, expected: string) {
  if (value.toISOString() !== expected) throw new McpMutationError("This record changed. Read it again and review the latest value before retrying with a new request ID.");
}
function requestKey(userId: string, key: string, operation: string) {
  return `mcp-${operation}:${createHash("sha256").update(`${userId}\0${key}`).digest("hex")}`;
}
async function mealSource(tx: Prisma.TransactionClient, userId: string, input: z.infer<typeof source>) {
  try { return await resolveSource(tx, userId, input); }
  catch (error) {
    if (error instanceof Error && ["Saved meal not found in your account.", "A meal item is missing or does not belong to your account.", "This meal needs to be saved again from your history.", "This older entry has no reusable nutrition. Review it before logging again."].includes(error.message)) throw new McpMutationError(error.message);
    throw error;
  }
}
async function acceptedBuddy(tx: Prisma.TransactionClient, userId: string, otherId: string) {
  // Keep authorization valid until the proposal/acceptance commits, including
  // when the website concurrently removes or changes the buddy relationship.
  const buddies = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "BuddyRelationship"
    WHERE "status" = 'ACCEPTED' AND (("requesterId" = ${userId} AND "addresseeId" = ${otherId})
    OR ("requesterId" = ${otherId} AND "addresseeId" = ${userId})) LIMIT 1 FOR SHARE`;
  if (!buddies.length || userId === otherId) throw new McpMutationError("This person is not a connected buddy. Check your buddy list before sharing or accepting meals.");
}

export async function getMcpSavedMeals(userId: string, input: z.input<typeof GetSavedMealsSchema> = {}, client: PrismaClient = prisma) {
  const parsed = GetSavedMealsSchema.parse(input);
  const rows = await client.savedMeal.findMany({ where: { userId }, orderBy: [{ name: "asc" }, { id: "asc" }], skip: parsed.offset, take: parsed.limit + 1 });
  return { meals: rows.slice(0, parsed.limit).map(row => ({
    id: row.id, name: row.name, updatedAt: row.updatedAt.toISOString(),
    items: parseStoredItems(row.items).map(publicMealItem), source: { kind: "saved" as const, id: row.id },
  })), hasMore: rows.length > parsed.limit, nextOffset: rows.length > parsed.limit ? parsed.offset + parsed.limit : null };
}

export async function saveMcpMealPreset(userId: string, input: z.input<typeof SaveMealPresetSchema>, client: PrismaClient = prisma) {
  const parsed = SaveMealPresetSchema.parse(input);
  return withMcpMutation(userId, parsed.requestId, "save_meal_preset", parsed, async tx => {
    const items = selectMealItems(await mealSource(tx, userId, parsed.source), parsed);
    const row = await tx.savedMeal.create({ data: { userId, name: parsed.name, items: json(items), pinned: true } });
    return { id: row.id, name: row.name, updatedAt: row.updatedAt.toISOString(), savedAsPreset: true };
  }, client);
}

export async function removeMcpMealPreset(userId: string, input: z.input<typeof RemoveMealPresetSchema>, client: PrismaClient = prisma) {
  const parsed = RemoveMealPresetSchema.parse(input);
  return withMcpMutation(userId, parsed.requestId, "remove_meal_preset", parsed, async tx => {
    const row = await tx.savedMeal.findFirst({ where: { id: parsed.id, userId } });
    if (!row) throw new McpMutationError("Saved meal not found in your account.");
    safeVersion(row.updatedAt, parsed.expectedUpdatedAt);
    const deleted = await tx.savedMeal.deleteMany({ where: { id: row.id, userId, updatedAt: new Date(parsed.expectedUpdatedAt) } });
    if (!deleted.count) throw new McpMutationError("This saved meal changed. Read it again before removing it.");
    return { id: row.id, removed: true };
  }, client);
}

export async function logMcpExistingMeal(userId: string, input: z.input<typeof LogExistingMealSchema>, client: PrismaClient = prisma) {
  const parsed = LogExistingMealSchema.parse(input);
  return withMcpMutation(userId, parsed.requestId, "log_existing_meal", parsed, async tx => {
    const receipt = await withMealBatchInTransaction(tx, { userId, requestId: requestKey(userId, parsed.requestId, "library"), kind: `mcp-library:${parsed.date}` }, async (writer, batchId) => {
      const items = selectMealItems(await mealSource(writer, userId, parsed.source), parsed);
      return insertMealSnapshots(writer, { userId, batchId, date: parsed.date, mealType: parsed.mealType, items });
    });
    return { ...receipt, date: parsed.date, saved: !receipt.undone };
  }, client);
}

export async function correctMcpMealEntries(userId: string, input: z.input<typeof CorrectMealEntriesSchema>, client: PrismaClient = prisma) {
  const parsed = CorrectMealEntriesSchema.parse(input);
  return withMcpMutation(userId, parsed.requestId, "correct_meal_entries", parsed, async tx => {
    const changed = [];
    const touchedBatches = new Set<string>();
    for (const edit of parsed.entries) {
      const entry = await tx.logEntry.findFirst({ where: { id: edit.entryId, userId }, include: { food: true } });
      if (!entry) throw new McpMutationError("A meal entry is missing or does not belong to your account. Refresh your daily log.");
      safeVersion(entry.updatedAt, edit.expectedUpdatedAt);
      const where = { id: entry.id, userId, updatedAt: new Date(edit.expectedUpdatedAt) };
      if (edit.action === "remove") {
        const result = await tx.logEntry.deleteMany({ where });
        if (!result.count) throw new McpMutationError("The meal changed. Refresh your daily log before removing it.");
        if (entry.batchId) touchedBatches.add(entry.batchId);
        changed.push({ id: entry.id, removed: true });
        continue;
      }
      const data: Prisma.LogEntryUpdateManyMutationInput = {};
      if (edit.multiplier !== undefined) {
        let snapshot;
        try { snapshot = snapshotMealEntry(entry, edit.multiplier); }
        catch { throw new McpMutationError("This entry has incomplete nutrition and cannot be scaled. Remove it and log a reviewed replacement instead."); }
        Object.assign(data, { amount: snapshot.amount, snapshotKcal: snapshot.snapshotKcal, snapshotProteinG: snapshot.snapshotProteinG,
          snapshotCarbsG: snapshot.snapshotCarbsG, snapshotFatG: snapshot.snapshotFatG, snapshotFiberG: snapshot.snapshotFiberG,
          estimationMeta: snapshot.estimationMeta === null ? Prisma.DbNull : json(snapshot.estimationMeta) });
      }
      if (edit.date !== undefined) data.date = edit.date;
      if (edit.mealType !== undefined) data.mealType = edit.mealType;
      if (edit.mealName !== undefined) data.mealName = edit.mealName;
      // Ensure the version advances even for two writes within one millisecond.
      const updatedAt = new Date(Math.max(Date.now(), entry.updatedAt.getTime() + 1));
      data.updatedAt = updatedAt;
      const result = await tx.logEntry.updateMany({ where, data });
      if (!result.count) throw new McpMutationError("The meal changed. Refresh your daily log before editing it.");
      changed.push({ id: entry.id, updatedAt: updatedAt.toISOString(), updated: true });
    }
    for (const batchId of touchedBatches) {
      if (await tx.logEntry.count({ where: { userId, batchId } }) === 0) await tx.logBatch.updateMany({ where: { id: batchId, userId, undoneAt: null }, data: { undoneAt: new Date() } });
    }
    return { changed, note: "Read the daily log for current totals. Replaying this request returns its original receipt without applying the edits again." };
  }, client);
}

export async function getMcpBuddyMeals(userId: string, input: z.input<typeof GetBuddyMealsSchema> = {}, client: PrismaClient = prisma) {
  const parsed = GetBuddyMealsSchema.parse(input);
  const relationships = await client.buddyRelationship.findMany({
    where: { status: "ACCEPTED", OR: [{ requesterId: userId }, { addresseeId: userId }] },
    select: { requesterId: true, requester: { select: { id: true, username: true } }, addressee: { select: { id: true, username: true } } },
    orderBy: { id: "asc" }, take: 101,
  });
  const buddies = relationships.slice(0, 100).map(row => row.requesterId === userId ? row.addressee : row.requester);
  const allowedIds = buddies.map(buddy => buddy.id);
  const pending = await client.mealProposal.findMany({
    where: { recipientId: userId, status: "PENDING", senderId: { in: allowedIds } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }], skip: parsed.offset, take: parsed.limit + 1,
    select: { id: true, name: true, date: true, mealType: true, items: true, senderId: true },
  });
  return { buddies, buddiesTruncated: relationships.length > 100,
    incoming: pending.slice(0, parsed.limit).map(row => ({ id: row.id, name: row.name, suggestedDate: row.date, suggestedMealType: row.mealType,
      sender: buddies.find(buddy => buddy.id === row.senderId), items: parseStoredItems(row.items).map(publicMealItem) })),
    hasMore: pending.length > parsed.limit, nextOffset: pending.length > parsed.limit ? parsed.offset + parsed.limit : null };
}

export async function shareMcpMeal(userId: string, input: z.input<typeof ShareMealSchema>, client: PrismaClient = prisma) {
  const parsed = ShareMealSchema.parse(input);
  return withMcpMutation(userId, parsed.requestId, "share_meal", parsed, async tx => {
    await acceptedBuddy(tx, userId, parsed.recipientId);
    const items = selectMealItems(await mealSource(tx, userId, parsed.source), parsed).map(itemForSharing);
    const proposal = await tx.mealProposal.create({ data: { senderId: userId, recipientId: parsed.recipientId,
      senderRequestId: requestKey(userId, parsed.requestId, "share"), name: parsed.name ?? "Shared meal", date: parsed.date,
      mealType: parsed.mealType, items: json(items) } });
    return { proposalId: proposal.id, recipientId: parsed.recipientId, status: "PENDING", savedToRecipientLog: false };
  }, client);
}

export async function respondMcpSharedMeal(userId: string, input: z.input<typeof RespondSharedMealSchema>, client: PrismaClient = prisma) {
  const parsed = RespondSharedMealSchema.parse(input);
  return withMcpMutation(userId, parsed.requestId, "respond_shared_meal", parsed, async tx => {
    const proposal = await tx.mealProposal.findFirst({ where: { id: parsed.proposalId, recipientId: userId } });
    if (!proposal) throw new McpMutationError("This incoming meal is not available to your account.");
    await acceptedBuddy(tx, userId, proposal.senderId);
    if (proposal.status !== "PENDING") throw new McpMutationError("This meal has already been answered. Refresh your incoming meals and daily log.");
    const status = parsed.action === "accept" ? "ACCEPTED" : "DECLINED";
    const claimed = await tx.mealProposal.updateMany({ where: { id: proposal.id, recipientId: userId, status: "PENDING" }, data: { status, respondedAt: new Date() } });
    if (!claimed.count) throw new McpMutationError("This meal has already been answered. Refresh your incoming meals and daily log.");
    if (parsed.action === "decline") return { proposalId: proposal.id, status, saved: false };
    const receipt = await withMealBatchInTransaction(tx, { userId, requestId: `proposal:${proposal.id}`, kind: "SHARED_MEAL" }, (writer, batchId) =>
      insertMealSnapshots(writer, { userId, batchId, date: parsed.date!, mealType: parsed.mealType!, items: selectMealItems(parseStoredItems(proposal.items), parsed) }));
    await tx.mealProposal.update({ where: { id: proposal.id }, data: { acceptedBatchId: receipt.batchId } });
    return { proposalId: proposal.id, status, saved: true, ...receipt, date: parsed.date! };
  }, client);
}
