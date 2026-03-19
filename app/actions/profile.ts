"use server";

import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";

const ProfileSchema = z.object({
  kcalTarget: z.number().min(500).max(10000),
  proteinTarget: z.number().min(0).max(1000),
  carbsTarget: z.number().min(0).max(2000),
  fatTarget: z.number().min(0).max(1000),
  fiberTarget: z.number().min(0).max(200).optional(),
});

export async function updateProfile(formData: FormData) {
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
    where: { id: 1 },
    update: parsed.data,
    create: { id: 1, ...parsed.data },
  });

  revalidatePath("/");
  revalidatePath("/profile");
}
