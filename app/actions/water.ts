"use server";

import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/session";

export async function incrementWater(date: string) {
  const user = await requireSession();

  await prisma.waterEntry.upsert({
    where: { userId_date: { userId: user.id, date } },
    update: { glasses: { increment: 1 } },
    create: { userId: user.id, date, glasses: 1 },
  });

  revalidatePath("/");
  revalidatePath("/history");
}

export async function decrementWater(date: string) {
  const user = await requireSession();

  const entry = await prisma.waterEntry.findUnique({
    where: { userId_date: { userId: user.id, date } },
  });

  if (entry && entry.glasses > 0) {
    await prisma.waterEntry.update({
      where: { id: entry.id },
      data: { glasses: { decrement: 1 } },
    });
  }

  revalidatePath("/");
  revalidatePath("/history");
}
