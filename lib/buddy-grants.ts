import type { BuddyRelationship, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";

type DirectionalGrant = Pick<BuddyRelationship, "requesterId" | "addresseeId" | "requesterAllowsMealLogging" | "addresseeAllowsMealLogging">;

export function allowsMealLoggingInto(relationship: DirectionalGrant, ownerId: string) {
  if (relationship.requesterId === ownerId) return relationship.requesterAllowsMealLogging;
  return relationship.addresseeId === ownerId && relationship.addresseeAllowsMealLogging;
}

// Legacy data can have one relationship in each direction. Lock in the same
// order as the meal writer and verify the submitted relationship still exists.
async function lockOwnedPair(tx: Prisma.TransactionClient, ownerId: string, relationshipId: string) {
  const selected = await tx.buddyRelationship.findFirst({
    where: { id: relationshipId, OR: [{ requesterId: ownerId }, { addresseeId: ownerId }] },
    select: { requesterId: true, addresseeId: true },
  });
  if (!selected || selected.requesterId === selected.addresseeId) return [];
  const { requesterId, addresseeId } = selected;
  const rows = await tx.$queryRaw<Array<Pick<BuddyRelationship, "id" | "requesterId" | "status">>>`
    SELECT id, "requesterId", status FROM "BuddyRelationship"
    WHERE ("requesterId" = ${requesterId} AND "addresseeId" = ${addresseeId})
       OR ("requesterId" = ${addresseeId} AND "addresseeId" = ${requesterId})
    ORDER BY id FOR UPDATE`;
  return rows.some(row => row.id === relationshipId) ? rows : [];
}

export async function setOwnerMealLoggingGrant(ownerId: string, relationshipId: string, allow: boolean, client: PrismaClient = prisma) {
  return client.$transaction(async tx => {
    const rows = await lockOwnedPair(tx, ownerId, relationshipId);
    const accepted = rows.filter(row => row.status === "ACCEPTED");
    if (!accepted.some(row => row.id === relationshipId)) return false;
    for (const row of accepted) {
      await tx.buddyRelationship.update({
        where: { id: row.id },
        data: row.requesterId === ownerId ? { requesterAllowsMealLogging: allow } : { addresseeAllowsMealLogging: allow },
      });
    }
    return true;
  });
}

export async function removeOwnedBuddyRelationship(ownerId: string, relationshipId: string, client: PrismaClient = prisma) {
  return client.$transaction(async tx => {
    const rows = await lockOwnedPair(tx, ownerId, relationshipId);
    if (!rows.length) return false;
    await tx.buddyRelationship.deleteMany({ where: { id: { in: rows.map(row => row.id) } } });
    return true;
  });
}
