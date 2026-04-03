"use server";

import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/session";
import { todayIsoDate } from "@/lib/dates";

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

export async function updateHealthProfile(formData: FormData) {
  const user = await requireSession();

  const allergies = formData.getAll("allergies") as string[];
  const customAllergy = (formData.get("customAllergy") as string)?.trim();
  if (customAllergy) allergies.push(...customAllergy.split(",").map((s) => s.trim()).filter(Boolean));

  const dietaryRestrictions = formData.getAll("dietaryRestrictions") as string[];
  const customRestriction = (formData.get("customRestriction") as string)?.trim();
  if (customRestriction) dietaryRestrictions.push(...customRestriction.split(",").map((s) => s.trim()).filter(Boolean));

  const healthConditions = formData.getAll("healthConditions") as string[];
  const customCondition = (formData.get("customCondition") as string)?.trim();
  if (customCondition) healthConditions.push(...customCondition.split(",").map((s) => s.trim()).filter(Boolean));

  await prisma.profile.upsert({
    where: { userId: user.id },
    update: { allergies, dietaryRestrictions, healthConditions },
    create: { userId: user.id, allergies, dietaryRestrictions, healthConditions },
  });

  revalidatePath("/profile");
}

export async function completeOnboarding(data: {
  goal: string;
  heightCm?: number;
  weightKg?: number;
  age?: number;
  gender?: string;
  kcalTarget: number;
  proteinTarget: number;
  carbsTarget: number;
  fatTarget: number;
  fiberTarget: number;
  allergies: string[];
  dietaryRestrictions: string[];
  healthConditions: string[];
}) {
  const user = await requireSession();

  await prisma.profile.upsert({
    where: { userId: user.id },
    update: {
      kcalTarget: data.kcalTarget,
      proteinTarget: data.proteinTarget,
      carbsTarget: data.carbsTarget,
      fatTarget: data.fatTarget,
      fiberTarget: data.fiberTarget,
      heightCm: data.heightCm,
      weightKg: data.weightKg,
      age: data.age,
      gender: data.gender,
      allergies: data.allergies,
      dietaryRestrictions: data.dietaryRestrictions,
      healthConditions: data.healthConditions,
      onboardingCompleted: true,
    },
    create: {
      userId: user.id,
      kcalTarget: data.kcalTarget,
      proteinTarget: data.proteinTarget,
      carbsTarget: data.carbsTarget,
      fatTarget: data.fatTarget,
      fiberTarget: data.fiberTarget,
      heightCm: data.heightCm,
      weightKg: data.weightKg,
      age: data.age,
      gender: data.gender,
      allergies: data.allergies,
      dietaryRestrictions: data.dietaryRestrictions,
      healthConditions: data.healthConditions,
      onboardingCompleted: true,
    },
  });

  if (data.weightKg) {
    const date = todayIsoDate();
    await prisma.weightEntry.upsert({
      where: { userId_date: { userId: user.id, date } },
      update: { weightKg: data.weightKg },
      create: { userId: user.id, date, weightKg: data.weightKg },
    });
  }

  revalidatePath("/");
}

const BodyStatsSchema = z.object({
  heightCm: z.number().min(50).max(300).optional(),
  weightKg: z.number().min(20).max(500).optional(),
  age: z.number().int().min(10).max(120).optional(),
  gender: z.string().optional(),
  equipmentPreset: z.string().optional(),
  equipment: z.array(z.string()).default([]),
});

export async function updateBodyStats(formData: FormData) {
  const user = await requireSession();

  const heightCm = formData.get("heightCm") ? Number(formData.get("heightCm")) : undefined;
  const weightKg = formData.get("weightKg") ? Number(formData.get("weightKg")) : undefined;
  const age = formData.get("age") ? Number(formData.get("age")) : undefined;
  const gender = (formData.get("gender") as string)?.trim() || undefined;
  const equipmentPreset = (formData.get("equipmentPreset") as string)?.trim() || undefined;
  const equipmentRaw = (formData.get("equipment") as string)?.trim() || "";
  const equipment = equipmentRaw
    ? equipmentRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  const parsed = BodyStatsSchema.safeParse({
    heightCm,
    weightKg,
    age,
    gender,
    equipmentPreset,
    equipment,
  });
  if (!parsed.success) return;

  await prisma.profile.upsert({
    where: { userId: user.id },
    update: parsed.data,
    create: { userId: user.id, ...parsed.data },
  });

  // Record weight history when weight is provided
  if (parsed.data.weightKg) {
    const date = todayIsoDate();
    await prisma.weightEntry.upsert({
      where: { userId_date: { userId: user.id, date } },
      update: { weightKg: parsed.data.weightKg },
      create: { userId: user.id, date, weightKg: parsed.data.weightKg },
    });
  }

  revalidatePath("/");
  revalidatePath("/profile");
  revalidatePath("/workouts");
  revalidatePath("/trends");
}
