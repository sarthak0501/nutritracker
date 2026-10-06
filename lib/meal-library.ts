import { createHash } from "node:crypto";
import { MealType, Prisma } from "@prisma/client";
import type { Food, LogEntry } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { todayIsoDate } from "@/lib/dates";
import { entryAmountLabel } from "@/lib/meal-units";
import {
  insertMealSnapshots,
  snapshotMealEntry,
  withMealBatch,
  withMealBatchInTransaction,
} from "@/lib/meal-writes";
import type { MealEntrySnapshot } from "@/lib/meal-writes";
import type {
  LibraryMeal,
  LogLibraryMealInput,
  MealItem,
  MealLibraryData,
  MealSelection,
  MealSource,
  ProposeSharedMealInput,
  RespondMealProposalInput,
} from "@/lib/meal-types";

const idSchema = z.string().min(1).max(200);
const nameSchema = z.string().trim().min(1).max(100);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Choose a valid date");
const sourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("saved"), id: idSchema }),
  z.object({ kind: z.literal("entries"), entryIds: z.array(idSchema).min(1).max(100) }),
]);
const selectionSchema = z.object({
  multiplier: z.number().finite().min(0.25).max(4).default(1),
  selectedItemIds: z.array(idSchema).min(1).max(100).optional(),
});
const logSchema = selectionSchema.extend({
  requestId: z.string().min(1).max(128),
  source: sourceSchema,
  date: dateSchema,
  mealType: z.nativeEnum(MealType),
});
const nutrientSchema = z.number().finite().min(0).max(1_000_000);

/** The server stores original snapshots, so legacy quantities are never reinterpreted. */
const storedItemSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(500),
  portionLabel: z.string().min(1).max(500),
  foodId: idSchema,
  amount: z.number().finite().positive().max(1_000_000),
  unit: z.enum(["GRAM", "SERVING"]),
  mealType: z.nativeEnum(MealType),
  mealName: z.string().nullable().optional(),
  isEstimated: z.boolean(),
  sourceText: z.string().nullable().optional(),
  estimationMeta: z.unknown().optional(),
  snapshotKcal: nutrientSchema,
  snapshotProteinG: nutrientSchema,
  snapshotCarbsG: nutrientSchema,
  snapshotFatG: nutrientSchema,
  snapshotFiberG: nutrientSchema.nullable().optional(),
});
export type StoredMealItem = MealEntrySnapshot & {
  id: string;
  name: string;
  portionLabel: string;
};

type Database = typeof prisma;
type Transaction = Prisma.TransactionClient;

function parseStoredItems(value: unknown): StoredMealItem[] {
  const result = z.array(storedItemSchema).min(1).max(100).safeParse(value);
  if (!result.success) throw new Error("This meal needs to be saved again from your history.");
  return result.data as StoredMealItem[];
}

function jsonItems(items: StoredMealItem[]): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(items)) as Prisma.InputJsonValue;
}

function labelForEntry(entry: LogEntry & { food: Food }): string {
  return entryAmountLabel(entry, entry.food);
}

export function storedItemFromEntry(entry: LogEntry & { food: Food }): StoredMealItem {
  const snapshot = snapshotMealEntry(entry);
  return {
    ...snapshot,
    id: entry.id,
    name: entry.food.name,
    portionLabel: labelForEntry(entry),
  };
}

export function publicMealItem(item: StoredMealItem): MealItem {
  return {
    id: item.id,
    foodId: item.foodId,
    name: item.name,
    amount: item.amount,
    unit: item.unit,
    portionLabel: item.portionLabel,
    nutrients: {
      kcal: item.snapshotKcal,
      protein_g: item.snapshotProteinG,
      carbs_g: item.snapshotCarbsG,
      fat_g: item.snapshotFatG,
      ...(item.snapshotFiberG == null ? {} : { fiber_g: item.snapshotFiberG }),
    },
    isEstimated: item.isEstimated,
  };
}

/** Selection is by server-owned item IDs; only nutrient snapshots are scaled. */
export function selectMealItems(items: StoredMealItem[], input: MealSelection): StoredMealItem[] {
  const selection = selectionSchema.parse(input);
  const selectedIds = selection.selectedItemIds ? new Set(selection.selectedItemIds) : null;
  if (selectedIds && [...selectedIds].some((id) => !items.some((item) => item.id === id))) {
    throw new Error("A selected item is no longer available. Refresh and try again.");
  }
  const selected = items.filter((item) => !selectedIds || selectedIds.has(item.id));
  if (!selected.length) throw new Error("Select at least one item.");
  const multiplier = selection.multiplier;
  return selected.map((item) => ({
    ...item,
    amount: item.amount * multiplier,
    portionLabel: multiplier === 1 ? item.portionLabel : `${multiplier} × (${item.portionLabel})`,
    snapshotKcal: item.snapshotKcal * multiplier,
    snapshotProteinG: item.snapshotProteinG * multiplier,
    snapshotCarbsG: item.snapshotCarbsG * multiplier,
    snapshotFatG: item.snapshotFatG * multiplier,
    snapshotFiberG: item.snapshotFiberG == null ? item.snapshotFiberG : item.snapshotFiberG * multiplier,
    // Do not change historical metadata to imply that an old portion was weighed.
    estimationMeta: {
      ...(item.estimationMeta && typeof item.estimationMeta === "object" && !Array.isArray(item.estimationMeta)
        ? item.estimationMeta : {}),
      repeatPortionLabel: multiplier === 1 ? item.portionLabel : `${multiplier} × (${item.portionLabel})`,
    },
  }));
}

/** A selected shared item must not carry the sender's unrelated full-day free text. */
export function itemForSharing(item: StoredMealItem): StoredMealItem {
  const meta = item.estimationMeta && typeof item.estimationMeta === "object" && !Array.isArray(item.estimationMeta)
    ? item.estimationMeta : {};
  return {
    ...item,
    sourceText: null,
    estimationMeta: {
      ...(typeof meta.originalUnit === "string" ? { originalUnit: meta.originalUnit } : {}),
      ...(typeof meta.originalQuantity === "number" ? { originalQuantity: meta.originalQuantity } : {}),
      repeatPortionLabel: item.portionLabel,
      sharedMeal: true,
    },
  };
}

async function resolveSource(db: Database | Transaction, userId: string, rawSource: MealSource): Promise<StoredMealItem[]> {
  const source = sourceSchema.parse(rawSource);
  if (source.kind === "saved") {
    const saved = await db.savedMeal.findFirst({ where: { id: source.id, userId } });
    if (!saved) throw new Error("Saved meal not found in your account.");
    return parseStoredItems(saved.items);
  }
  const entryIds = [...new Set(source.entryIds)];
  const entries = await db.logEntry.findMany({
    where: { id: { in: entryIds }, userId },
    include: { food: true },
    orderBy: { createdAt: "asc" },
  });
  if (entries.length !== entryIds.length) throw new Error("A meal item is missing or does not belong to your account.");
  return entries.map(storedItemFromEntry);
}

async function requireBuddy(db: Database | Transaction, userId: string, recipientId: string) {
  if (userId === recipientId) throw new Error("Choose your connected buddy.");
  const relationship = await db.buddyRelationship.findFirst({
    where: { status: "ACCEPTED", OR: [
      { requesterId: userId, addresseeId: recipientId },
      { requesterId: recipientId, addresseeId: userId },
    ] },
  });
  if (!relationship) throw new Error("This person is no longer your connected buddy.");
}

export async function saveMealPresetForUser(userId: string, input: MealSelection & { name: string; source: MealSource; requestId?: string }) {
  const name = nameSchema.parse(input.name);
  const requestId = z.string().min(1).max(128).optional().parse(input.requestId);
  const id = requestId ? `meal_${createHash("sha256").update(`${userId}\0${requestId}`).digest("hex")}` : undefined;
  if (id) {
    const existing = await prisma.savedMeal.findFirst({ where: { id, userId }, select: { id: true } });
    if (existing) return existing;
  }
  const items = selectMealItems(await resolveSource(prisma, userId, input.source), input);
  const data = { userId, name, items: jsonItems(items), pinned: true };
  try {
    const saved = await prisma.savedMeal.create({ data: { ...data, ...(id ? { id } : {}) } });
    return { id: saved.id };
  } catch (error) {
    if (id && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.savedMeal.findFirst({ where: { id, userId }, select: { id: true } });
      if (existing) return existing;
    }
    throw error;
  }
}

export async function updateMealPresetForUser(userId: string, input: { id: string; name?: string; pinned?: boolean }) {
  const parsed = z.object({ id: idSchema, name: nameSchema.optional(), pinned: z.boolean().optional() }).parse(input);
  const result = await prisma.savedMeal.updateMany({
    where: { id: parsed.id, userId },
    data: { ...(parsed.name === undefined ? {} : { name: parsed.name }), ...(parsed.pinned === undefined ? {} : { pinned: parsed.pinned }) },
  });
  if (!result.count) throw new Error("Saved meal not found in your account.");
}

export async function deleteMealPresetForUser(userId: string, id: string) {
  await prisma.savedMeal.deleteMany({ where: { id: idSchema.parse(id), userId } });
}

export async function logLibraryMealForUser(userId: string, input: LogLibraryMealInput) {
  const parsed = logSchema.parse(input);
  return withMealBatch({ userId, requestId: parsed.requestId, kind: "REPEAT_MEAL" }, async (tx, batchId) => {
    const items = selectMealItems(await resolveSource(tx, userId, parsed.source), parsed);
    return insertMealSnapshots(tx, { userId, batchId, date: parsed.date, mealType: parsed.mealType, items });
  });
}

export async function proposeSharedMealForUser(userId: string, input: ProposeSharedMealInput) {
  const parsed = logSchema.extend({ recipientId: idSchema, name: nameSchema.optional() }).parse(input);
  try {
    return await prisma.$transaction(async (tx) => {
    await requireBuddy(tx, userId, parsed.recipientId);
    const existing = await tx.mealProposal.findUnique({ where: { senderId_senderRequestId: { senderId: userId, senderRequestId: parsed.requestId } } });
    if (existing) {
      if (existing.recipientId !== parsed.recipientId) throw new Error("This request was already shared with a different recipient.");
      return { proposalId: existing.id };
    }
    const items = selectMealItems(await resolveSource(tx, userId, parsed.source), parsed).map(itemForSharing);
    const proposal = await tx.mealProposal.create({
      data: {
        senderId: userId, recipientId: parsed.recipientId, senderRequestId: parsed.requestId,
        name: parsed.name || "Shared meal", date: parsed.date, mealType: parsed.mealType, items: jsonItems(items),
      },
    });
    if (proposal.recipientId !== parsed.recipientId) throw new Error("This request was already shared with a different recipient.");
    return { proposalId: proposal.id };
    });
  } catch (error) {
    // A unique conflict aborts PostgreSQL's transaction; resolve the committed
    // winning request outside that transaction without inserting anything again.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.mealProposal.findUnique({ where: { senderId_senderRequestId: { senderId: userId, senderRequestId: parsed.requestId } } });
      if (existing) {
        if (existing.recipientId !== parsed.recipientId) throw new Error("This request was already shared with a different recipient.");
        return { proposalId: existing.id };
      }
    }
    throw error;
  }
}

export async function respondMealProposalForUser(userId: string, input: RespondMealProposalInput): Promise<{ batchId?: string; entryCount?: number; undone?: boolean }> {
  const parsed = selectionSchema.extend({
    proposalId: idSchema,
    action: z.enum(["accept", "decline"]),
    date: dateSchema.optional(),
    mealType: z.nativeEnum(MealType).optional(),
  }).parse(input);
  if (parsed.action === "accept" && (!parsed.date || !parsed.mealType)) throw new Error("Choose your date and meal before accepting.");
  return prisma.$transaction(async (tx) => {
    const proposal = await tx.mealProposal.findFirst({ where: { id: parsed.proposalId, recipientId: userId } });
    if (!proposal) throw new Error("This meal proposal is not available to your account.");
    await requireBuddy(tx, userId, proposal.senderId);
    const status = parsed.action === "accept" ? "ACCEPTED" : "DECLINED";
    const transitioned = await tx.mealProposal.updateMany({
      where: { id: proposal.id, recipientId: userId, status: "PENDING" },
      data: { status, respondedAt: new Date() },
    });
    if (!transitioned.count) {
      const current = await tx.mealProposal.findUniqueOrThrow({ where: { id: proposal.id } });
      if (current.status !== status) throw new Error("This proposal has already been answered.");
      if (!current.acceptedBatchId) return {};
      const batch = await tx.logBatch.findFirst({ where: { id: current.acceptedBatchId, userId }, include: { _count: { select: { entries: true } } } });
      return batch ? { batchId: batch.id, entryCount: batch._count.entries, ...(batch.undoneAt ? { undone: true } : {}) } : {};
    }
    if (parsed.action === "decline") return {};
    const items = selectMealItems(parseStoredItems(proposal.items), parsed);
    const result = await withMealBatchInTransaction(tx, {
      userId, requestId: `proposal:${proposal.id}`, kind: "SHARED_MEAL",
    }, async (writerTx, batchId) => insertMealSnapshots(writerTx, {
      userId, batchId, date: parsed.date!, mealType: parsed.mealType!, items,
    }));
    await tx.mealProposal.update({ where: { id: proposal.id }, data: { acceptedBatchId: result.batchId } });
    return { batchId: result.batchId, entryCount: result.entryCount, ...(result.undone ? { undone: true } : {}) };
  });
}

export function weekStartForDate(date: string): string {
  const parsed = new Date(`${dateSchema.parse(date)}T00:00:00.000Z`);
  const daysSinceMonday = (parsed.getUTCDay() + 6) % 7;
  parsed.setUTCDate(parsed.getUTCDate() - daysSinceMonday);
  return parsed.toISOString().slice(0, 10);
}

export async function setCooperativeCheckInForUser(userId: string, enabled: boolean) {
  const value = z.boolean().parse(enabled);
  await prisma.profile.upsert({
    where: { userId },
    create: { userId, cooperativeCheckInEnabled: value },
    update: { cooperativeCheckInEnabled: value },
  });
}

export async function completeWeeklyCheckInForUser(userId: string) {
  const profile = await prisma.profile.findUnique({ where: { userId }, select: { cooperativeCheckInEnabled: true } });
  if (!profile?.cooperativeCheckInEnabled) throw new Error("Enable your weekly check-in first.");
  const weekStart = weekStartForDate(todayIsoDate());
  await prisma.weeklyCheckIn.upsert({ where: { userId_weekStart: { userId, weekStart } }, create: { userId, weekStart }, update: {} });
}

export async function getMealLibrary(userId: string, today = todayIsoDate()): Promise<MealLibraryData> {
  const weekStart = weekStartForDate(today);
  const [savedRows, entries, relationship, profile, ownCheckIn, pendingRows] = await Promise.all([
    prisma.savedMeal.findMany({ where: { userId }, orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }] }),
    prisma.logEntry.findMany({ where: { userId }, include: { food: true }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 200 }),
    prisma.buddyRelationship.findFirst({ where: { status: "ACCEPTED", OR: [{ requesterId: userId }, { addresseeId: userId }] }, include: { requester: { select: { id: true, username: true } }, addressee: { select: { id: true, username: true } } } }),
    prisma.profile.findUnique({ where: { userId }, select: { cooperativeCheckInEnabled: true } }),
    prisma.weeklyCheckIn.findUnique({ where: { userId_weekStart: { userId, weekStart } }, select: { id: true } }),
    prisma.mealProposal.findMany({
      where: {
        recipientId: userId, status: "PENDING",
        sender: { OR: [
          { buddyRequestsSent: { some: { addresseeId: userId, status: "ACCEPTED" } } },
          { buddyRequestsReceived: { some: { requesterId: userId, status: "ACCEPTED" } } },
        ] },
      },
      include: { sender: { select: { id: true, username: true } }, recipient: { select: { id: true, username: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const buddy = relationship ? (relationship.requesterId === userId ? relationship.addressee : relationship.requester) : null;
  const enabled = profile?.cooperativeCheckInEnabled ?? false;
  const [sentRows, buddyProfile, buddyCheckIn] = buddy ? await Promise.all([
    prisma.mealProposal.findMany({
      where: { senderId: userId, recipientId: buddy.id },
      include: { sender: { select: { id: true, username: true } }, recipient: { select: { id: true, username: true } } },
      orderBy: { createdAt: "desc" }, take: 10,
    }),
    enabled ? prisma.profile.findUnique({ where: { userId: buddy.id }, select: { cooperativeCheckInEnabled: true } }) : null,
    enabled ? prisma.weeklyCheckIn.findUnique({ where: { userId_weekStart: { userId: buddy.id, weekStart } }, select: { id: true } }) : null,
  ]) : [[], null, null];
  const saved = savedRows.map((row): LibraryMeal => {
    const items = parseStoredItems(row.items);
    return { id: row.id, name: row.name, mealType: items[0].mealType, pinned: row.pinned, items: items.map(publicMealItem), source: { kind: "saved", id: row.id } };
  });
  const groups = new Map<string, typeof entries>();
  for (const entry of entries) {
    const key = `${entry.batchId || entry.date}:${entry.mealType}:${entry.mealName || ""}`;
    const group = groups.get(key) || [];
    group.push(entry);
    groups.set(key, group);
  }
  const recent: LibraryMeal[] = [];
  for (const [id, group] of groups) {
    if (recent.length >= 8) break;
    if (group.length > 100) continue;
    // An incomplete older record should still be visible in History, without
    // preventing Today from loading or being silently assigned made-up macros.
    let items: MealItem[];
    try { items = group.map(storedItemFromEntry).map(publicMealItem); } catch { continue; }
    recent.push({
      id, name: group[0].mealName || `${group[0].mealType.charAt(0)}${group[0].mealType.slice(1).toLowerCase()}`,
      mealType: group[0].mealType, date: group[0].date, items,
      source: { kind: "entries", entryIds: group.map((entry) => entry.id) },
    });
  }
  const views = [...pendingRows, ...sentRows].map((row) => ({
    id: row.id, name: row.name, date: row.date, mealType: row.mealType,
    sender: row.sender, recipient: row.recipient,
    status: row.status as "PENDING" | "ACCEPTED" | "DECLINED",
    items: parseStoredItems(row.items).map(publicMealItem),
  }));
  const bothEnabled = enabled && !!buddyProfile?.cooperativeCheckInEnabled;
  return {
    saved, recent, buddy,
    pending: views.filter((row) => row.recipient.id === userId && row.status === "PENDING"),
    sent: views.filter((row) => row.sender.id === userId).slice(0, 10),
    checkIn: { enabled, weekStart, completed: !!ownCheckIn, buddyEnabled: bothEnabled, buddyCompleted: bothEnabled ? !!buddyCheckIn : null },
  };
}
