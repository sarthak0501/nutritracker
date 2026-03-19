import { prisma } from "@/lib/db";

export async function getBuddyId(userId: string): Promise<string | null> {
  const rel = await prisma.buddyRelationship.findFirst({
    where: {
      status: "ACCEPTED",
      OR: [{ requesterId: userId }, { addresseeId: userId }],
    },
  });
  if (!rel) return null;
  return rel.requesterId === userId ? rel.addresseeId : rel.requesterId;
}

export async function getBuddyEntriesForDate(buddyId: string, date: string) {
  return prisma.logEntry.findMany({
    where: { userId: buddyId, date },
    include: {
      food: true,
      reactions: {
        include: { user: { select: { id: true, username: true } } },
      },
    },
    orderBy: [{ mealType: "asc" }, { createdAt: "asc" }],
  });
}

export async function getBuddyInfo(buddyId: string) {
  return prisma.user.findUnique({
    where: { id: buddyId },
    select: { id: true, username: true },
  });
}
