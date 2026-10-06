import { randomUUID } from "node:crypto";
import { AmountUnit, MealType, Prisma, type Food, type LogEntry, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { safeNutrientsForEntry } from "@/lib/nutrition";
import { entryAmountLabel } from "@/lib/meal-units";

export type LogResult = { batchId: string; entryCount: number; alreadySaved?: boolean; undone?: boolean };
export type BatchOptions = { userId: string; requestId?: string; kind: string };
export type MealEntrySnapshot = {
  foodId: string;
  amount: number;
  unit: AmountUnit;
  mealType: MealType;
  mealName: string | null;
  isEstimated: boolean;
  sourceText: string | null;
  estimationMeta: Prisma.JsonValue | null;
  snapshotKcal: number;
  snapshotProteinG: number;
  snapshotCarbsG: number;
  snapshotFatG: number;
  snapshotFiberG: number | null;
};

export const mealDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Invalid date");
export const portionMultiplierSchema = z.number().finite().positive().max(20);
const nutrient = z.number().finite().nonnegative();
const snapshotSchema = z.object({
  foodId: z.string().min(1), amount: z.number().finite().positive(), unit: z.nativeEnum(AmountUnit),
  mealType: z.nativeEnum(MealType), mealName: z.string().max(200).nullable(),
  isEstimated: z.boolean(), sourceText: z.string().max(20000).nullable(),
  estimationMeta: z.unknown(), snapshotKcal: nutrient, snapshotProteinG: nutrient,
  snapshotCarbsG: nutrient, snapshotFatG: nutrient, snapshotFiberG: nutrient.nullable(),
});

export function validateRequestId(requestId?: string): string {
  if (requestId === undefined) return randomUUID();
  if (typeof requestId !== "string" || !requestId.trim() || requestId.length > 128) {
    throw new Error("Invalid save request. Please try again.");
  }
  return requestId;
}

type BatchWriter = (tx: Prisma.TransactionClient, batchId: string) => Promise<number>;
function existingResult(batch: { id: string; kind: string; undoneAt: Date | null; _count: { entries: number } }, kind: string): LogResult {
  if (batch.kind !== kind) throw new Error("This save request was already used. Please start a new save.");
  return { batchId: batch.id, entryCount: batch._count.entries, alreadySaved: true, ...(batch.undoneAt ? { undone: true } : {}) };
}

/** Caller owns the transaction, including retrying any concurrent unique conflict. */
export async function withMealBatchInTransaction(tx: Prisma.TransactionClient, options: BatchOptions, writer: BatchWriter): Promise<LogResult> {
  const requestId = validateRequestId(options.requestId);
  const existing = await tx.logBatch.findUnique({
    where: { userId_requestId: { userId: options.userId, requestId } }, include: { _count: { select: { entries: true } } },
  });
  if (existing) return existingResult(existing, options.kind);
  const batch = await tx.logBatch.create({ data: { userId: options.userId, requestId, kind: options.kind } });
  const entryCount = await writer(tx, batch.id);
  if (!Number.isInteger(entryCount) || entryCount < 1 || entryCount > 100) throw new Error("Choose between 1 and 100 food items.");
  return { batchId: batch.id, entryCount };
}

/** A request key covers both Food creation and every entry; failures roll everything back. */
export async function withMealBatch(options: BatchOptions, writer: BatchWriter, client: PrismaClient = prisma): Promise<LogResult> {
  const requestId = validateRequestId(options.requestId);
  try {
    return await client.$transaction((tx) => withMealBatchInTransaction(tx, { ...options, requestId }, writer), { timeout: 20_000 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await client.logBatch.findUnique({
        where: { userId_requestId: { userId: options.userId, requestId } }, include: { _count: { select: { entries: true } } },
      });
      if (existing) return existingResult(existing, options.kind);
    }
    throw error;
  }
}

/** Copy what the person actually logged, including zero macros and estimate provenance. */
export function snapshotMealEntry(entry: LogEntry & { food: Food }, multiplier = 1): MealEntrySnapshot {
  portionMultiplierSchema.parse(multiplier);
  const nutrients = safeNutrientsForEntry(entry, entry.food);
  if (!nutrients) throw new Error("This older entry has no reusable nutrition. Review it before logging again.");
  const snapshot: MealEntrySnapshot = {
    foodId: entry.foodId, amount: entry.amount * multiplier, unit: entry.unit, mealType: entry.mealType,
    mealName: entry.mealName, isEstimated: entry.isEstimated, sourceText: entry.sourceText,
    estimationMeta: multiplier === 1 ? entry.estimationMeta : {
      ...(entry.estimationMeta && typeof entry.estimationMeta === "object" && !Array.isArray(entry.estimationMeta) ? entry.estimationMeta : {}),
      repeatPortionLabel: `${multiplier} × (${entryAmountLabel(entry, entry.food)})`,
    }, snapshotKcal: nutrients.kcal * multiplier,
    snapshotProteinG: nutrients.protein_g * multiplier, snapshotCarbsG: nutrients.carbs_g * multiplier,
    snapshotFatG: nutrients.fat_g * multiplier, snapshotFiberG: nutrients.fiber_g == null ? null : nutrients.fiber_g * multiplier,
  };
  snapshotSchema.parse(snapshot);
  return snapshot;
}

export async function insertMealSnapshots(tx: Prisma.TransactionClient, input: {
  userId: string; batchId: string; date: string; items: MealEntrySnapshot[]; mealType?: MealType;
}): Promise<number> {
  mealDateSchema.parse(input.date);
  if (!input.items.length || input.items.length > 100) throw new Error("Choose between 1 and 100 food items.");
  if (input.mealType) z.nativeEnum(MealType).parse(input.mealType);
  for (const item of input.items) snapshotSchema.parse(item);
  const result = await tx.logEntry.createMany({ data: input.items.map((item) => ({
    foodId: item.foodId, amount: item.amount, unit: item.unit, mealName: item.mealName,
    isEstimated: item.isEstimated, sourceText: item.sourceText, snapshotKcal: item.snapshotKcal,
    snapshotProteinG: item.snapshotProteinG, snapshotCarbsG: item.snapshotCarbsG,
    snapshotFatG: item.snapshotFatG, snapshotFiberG: item.snapshotFiberG,
    userId: input.userId, batchId: input.batchId, date: input.date,
    mealType: input.mealType ?? item.mealType,
    estimationMeta: item.estimationMeta === null ? Prisma.DbNull : item.estimationMeta as Prisma.InputJsonValue,
  })) });
  return result.count;
}

export async function undoMealBatch(userId: string, batchId: string, client: PrismaClient = prisma): Promise<{ batchId: string; undone: true; entryCount: number }> {
  if (!batchId || batchId.length > 128) throw new Error("Invalid meal save.");
  return client.$transaction(async (tx) => {
    const batch = await tx.logBatch.findFirst({ where: { id: batchId, userId } });
    if (!batch) throw new Error("Meal save not found.");
    if (batch.undoneAt) return { batchId, undone: true as const, entryCount: 0 };
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    if (batch.createdAt < cutoff) throw new Error("Undo is available for 24 hours. You can still remove individual entries.");
    const claimed = await tx.logBatch.updateMany({
      where: { id: batchId, userId, undoneAt: null, createdAt: { gte: cutoff } }, data: { undoneAt: new Date() },
    });
    if (!claimed.count) return { batchId, undone: true as const, entryCount: 0 };
    const removed = await tx.logEntry.deleteMany({ where: { batchId, userId } });
    return { batchId, undone: true as const, entryCount: removed.count };
  });
}
