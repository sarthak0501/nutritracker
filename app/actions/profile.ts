"use server";

import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/session";

const ProfileSchema = z.object({
  kcalTarget: z.number().min(500).max(10000),
  proteinTarget: z.number().min(0).max(1000),
  carbsTarget: z.number().min(0).max(2000),
  fatTarget: z.number().min(0).max(1000),
  fiberTarget: z.number().min(0).max(200).optional(),
});

export async function updateProfile(formData: FormData) {
  const user = await requireSession();

  const raw = {
    kcalTarget: Number(formData.get("kcalTarget")),
    proteinTarget: Number(formData.get("proteinTarget")),
    carbsTarget: Number(formData.get("carbsTarget")),
    fatTarget: Number(formData.get("fatTarget")),
    fiberTarget: formData.get("fiberTarget") ? Number(formData.get("fiberTarget")) : undefined,
  };

  const parsed = ProfileSchema.safeParse(raw);
  if (!parsed.success) return;

  await prisma.profile.upsert({
    where: { userId: user.id },
    update: parsed.data,
    create: { userId: user.id, ...parsed.data },
  });

  revalidatePath("/");
  revalidatePath("/profile");
}
