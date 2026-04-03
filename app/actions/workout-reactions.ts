"use server";

import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getBuddyId } from "@/lib/buddy";

const ReactionTypeSchema = z.enum(["THUMBS_UP", "THUMBS_DOWN", "FIRE", "MUSCLE"]);

export async function toggleWorkoutReaction(workoutEntryId: string, type: string) {
  const user = await requireSession();
  const reactionType = ReactionTypeSchema.parse(type);

  const entry = await prisma.workoutEntry.findUnique({
    where: { id: workoutEntryId },
    select: { userId: true },
  });
  if (!entry) throw new Error("Entry not found");

  const buddyId = await getBuddyId(user.id);
  if (!buddyId || entry.userId !== buddyId) throw new Error("Not your buddy's entry");

  const existing = await prisma.workoutReaction.findUnique({
    where: { workoutEntryId_userId_type: { workoutEntryId, userId: user.id, type: reactionType } },
  });

  if (existing) {
    await prisma.workoutReaction.delete({ where: { id: existing.id } });
  } else {
    await prisma.workoutReaction.create({
      data: { workoutEntryId, userId: user.id, type: reactionType },
    });
  }

  revalidatePath("/");
}
