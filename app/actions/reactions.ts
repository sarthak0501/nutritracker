"use server";

import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getBuddyId } from "@/lib/buddy";

const ReactionTypeSchema = z.enum(["THUMBS_UP", "THUMBS_DOWN", "FIRE", "MUSCLE"]);

export async function toggleReaction(logEntryId: string, type: string) {
  const user = await requireSession();
  const reactionType = ReactionTypeSchema.parse(type);

  const entry = await prisma.logEntry.findUnique({
    where: { id: logEntryId },
    select: { userId: true },
  });
  if (!entry) throw new Error("Entry not found");

  const buddyId = await getBuddyId(user.id);
  if (!buddyId || entry.userId !== buddyId) throw new Error("Not your buddy's entry");

  const existing = await prisma.reaction.findUnique({
    where: { logEntryId_userId_type: { logEntryId, userId: user.id, type: reactionType } },
  });

  if (existing) {
    await prisma.reaction.delete({ where: { id: existing.id } });
  } else {
    await prisma.reaction.create({
      data: { logEntryId, userId: user.id, type: reactionType },
    });
  }

  revalidatePath("/");
  revalidatePath("/history");
}
